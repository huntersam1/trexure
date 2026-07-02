import "server-only";

import { randomBytes } from "node:crypto";
import { forTenant } from "../db";
import { shield } from "../zk";
import { buildAndSubmitPrivatePayment } from "../stellar/client";
import { QUEUE, watchOnchainQueue, reconcileQueue } from "../queue";
import { corridorFor, type CreatePaymentInput, type ListPaymentsQuery } from "../validation/payments";
import { AppError } from "../http/problem";
import { logger } from "../log";
import type { Prisma } from "../generated/prisma/client";

export type PaymentListItem = {
  id: string;
  status: string;
  sourceAmount: string;
  targetCurrency: string;
  corridorFrom: string;
  corridorTo: string;
  createdAt: string;
};

export type PaymentDetail = {
  id: string;
  intentId: string;
  status: string;
  sourceAsset: string;
  sourceAmount: string;
  targetCurrency: string;
  targetAmount: string | null;
  corridorFrom: string;
  corridorTo: string;
  recipientRef: string;
  shielded: boolean;
  proofHash: string | null;
  createdAt: string;
  updatedAt: string;
  legs: Array<{
    id: string;
    legType: string;
    status: string;
    txHash: string | null;
    ledger: number | null;
    contractId: string | null;
    provider: string | null;
    providerRef: string | null;
    bankRef: string | null;
    amount: string | null;
    currency: string | null;
  }>;
  receipt: { id: string; json: unknown; generatedAt: string } | null;
};

const newIntentId = (): string => `intent_${randomBytes(16).toString("hex")}`;

/**
 * Create a private payment: shield the payload (stub in Phase 3), submit the Soroban tx
 * (intentId rides as a contract-call argument), persist Payment(PENDING) + ONCHAIN leg,
 * enqueue watch-onchain.
 * Amounts are stored as Prisma Decimal — the validated decimal string is passed straight through.
 */
export async function createPayment(
  tenantId: string,
  input: CreatePaymentInput,
): Promise<{ id: string; intentId: string; status: string }> {
  const db = forTenant(tenantId);
  const intentId = newIntentId();
  const { from, to } = corridorFor(input.sourceAsset, input.targetCurrency);

  // 1. Shield the true payload (Phase 6 swaps the stub for real ZK behind this same call).
  const shielded = await shield({
    recipientRef: input.recipientRef,
    amount: input.amount,
    sourceAsset: input.sourceAsset,
    targetCurrency: input.targetCurrency,
    intentId,
    // The optional user memo is private data: it lives only in the shielded
    // payload. Soroban txs cannot carry classic memos (#30).
    ...(input.memo ? { memo: input.memo } : {}),
  });

  // 2. Submit the Soroban tx. The intentId — the reconciliation join key — is the
  //    first contract-call argument; the watch-onchain worker matches on contract
  //    events, never on a tx memo. The proofHash rides along as the recorded
  //    commitment so the event watch-onchain consumes carries the real value.
  const onchain = await buildAndSubmitPrivatePayment({
    intentId,
    amount: input.amount,
    sourceAsset: input.sourceAsset,
    commitment: shielded.proofHash,
  });

  // 3. Persist Payment + ONCHAIN leg. tenantId is injected by the forTenant() extension
  //    at runtime, and the AES-derived Bytes are Node Buffers — both reasons the data is
  //    asserted to the Prisma input type (see Phase 0/2 notes on Bytes + tenant scoping).
  const data = {
    intentId,
    status: "PENDING",
    sourceAsset: input.sourceAsset,
    sourceAmount: input.amount, // Prisma coerces the decimal string to Decimal(38,8).
    targetCurrency: input.targetCurrency,
    corridorFrom: from,
    corridorTo: to,
    recipientRef: input.recipientRef,
    shielded: true,
    encryptedPayload: shielded.encryptedPayload,
    payloadNonce: shielded.payloadNonce,
    proofHash: shielded.proofHash,
    legs: {
      create: {
        legType: "ONCHAIN",
        status: "PENDING",
        txHash: onchain.txHash,
        ledger: onchain.ledger,
        contractId: onchain.contractId,
      },
    },
  } as unknown as Prisma.PaymentUncheckedCreateInput;

  const payment = await db.payment.create({ data });

  // 4. Enqueue watch-onchain for the worker (Phase 5 consumes it).
  await watchOnchainQueue.add(QUEUE.WATCH_ONCHAIN, { paymentId: payment.id });

  logger.info({ paymentId: payment.id, intentId }, "payment created (PENDING)");
  return { id: payment.id, intentId, status: payment.status };
}

/** Tenant-scoped, cursor-paginated payment list with optional status/corridor filters. */
export async function listPayments(
  tenantId: string,
  q: ListPaymentsQuery,
): Promise<{ items: PaymentListItem[]; nextCursor: string | null }> {
  const db = forTenant(tenantId);
  const where: Prisma.PaymentWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.corridor) {
    const [from, to] = q.corridor.split("->");
    if (from) where.corridorFrom = from;
    if (to) where.corridorTo = to;
  }

  const rows = await db.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q.limit + 1, // fetch one extra to compute nextCursor
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;

  return {
    items: page.map((p) => ({
      id: p.id,
      status: p.status,
      sourceAmount: p.sourceAmount.toString(),
      targetCurrency: p.targetCurrency,
      corridorFrom: p.corridorFrom,
      corridorTo: p.corridorTo,
      createdAt: p.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/** Full payment + legs + receipt, tenant-scoped. Throws AppError(404) if missing/cross-tenant. */
export async function getPaymentById(tenantId: string, id: string): Promise<PaymentDetail> {
  const db = forTenant(tenantId);
  const p = await db.payment.findFirst({
    where: { id },
    include: { legs: true, receipt: true },
  });
  if (!p) throw new AppError(404, "Payment not found", `No payment ${id} for this tenant`);

  return {
    id: p.id,
    intentId: p.intentId,
    status: p.status,
    sourceAsset: p.sourceAsset,
    sourceAmount: p.sourceAmount.toString(),
    targetCurrency: p.targetCurrency,
    targetAmount: p.targetAmount ? p.targetAmount.toString() : null,
    corridorFrom: p.corridorFrom,
    corridorTo: p.corridorTo,
    recipientRef: p.recipientRef,
    shielded: p.shielded,
    proofHash: p.proofHash,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    legs: p.legs.map((l) => ({
      id: l.id,
      legType: l.legType,
      status: l.status,
      txHash: l.txHash,
      ledger: l.ledger,
      contractId: l.contractId,
      provider: l.provider,
      providerRef: l.providerRef,
      bankRef: l.bankRef,
      amount: l.amount ? l.amount.toString() : null,
      currency: l.currency,
    })),
    receipt: p.receipt
      ? { id: p.receipt.id, json: p.receipt.json, generatedAt: p.receipt.generatedAt.toISOString() }
      : null,
  };
}

/** Re-enqueue reconcile for a payment the caller's tenant owns. Throws 404 otherwise. */
export async function enqueueReconcile(tenantId: string, paymentId: string): Promise<void> {
  const db = forTenant(tenantId);
  const exists = await db.payment.findFirst({ where: { id: paymentId }, select: { id: true } });
  if (!exists) throw new AppError(404, "Payment not found", `No payment ${paymentId} for this tenant`);
  await reconcileQueue.add(QUEUE.RECONCILE, { paymentId });
  logger.info({ paymentId }, "reconcile re-enqueued");
}

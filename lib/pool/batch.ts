import "server-only";

import { randomBytes } from "node:crypto";

import { forTenant } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";
import { createPoolDeposit } from "@/lib/pool/service";
import { poolContractId } from "@/lib/pool/sync";
import type { PoolBatchInput, PoolBatchReceiverInput } from "@/lib/validation/pool";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Batch send service (P2, #84 — part of the batch private payments epic #80).
 * For each receiver row: run a pool deposit (`createPoolDeposit`) to mint a
 * claimable note, then persist a child `Payment` (payoutMethod POOL_WALLET,
 * storing the public commitment) under a single `PaymentBatch`. Returns each
 * row's copy-pasteable claim details.
 *
 * Bearer safety: only the public `poolCommitment` is persisted — never the note
 * itself (it is echoed once in the response; the payer must deliver it privately).
 *
 * Partial-failure: a deposit that throws does NOT abort the batch — that row is
 * reported `ok: false` with an error, and the successful notes are preserved.
 */

const newIntentId = (): string => `intent_${randomBytes(16).toString("hex")}`;

export type BatchReceiverSuccess = {
  ok: true;
  ref: string;
  email: string | null;
  amount: number;
  paymentId: string;
  intentId: string;
  note: string;
  commitment: string;
  claimUrl: string;
  poolContractId: string;
  deposit: { txHash: string; explorerUrl: string };
};

export type BatchReceiverFailure = {
  ok: false;
  ref: string;
  email: string | null;
  amount: number;
  error: string;
};

export type BatchReceiverResult = BatchReceiverSuccess | BatchReceiverFailure;

export type PoolBatchResult = {
  batchId: string;
  requested: number; // rows submitted
  count: number; // rows that succeeded
  totalSourceAmount: number; // sum of successful amounts (XLM)
  poolContractId: string;
  claimUrl: string;
  results: BatchReceiverResult[];
};

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : "Deposit failed";

/**
 * Run one batch of private disbursements for `tenantId`, created by `createdByUserId`.
 * Deposits are performed sequentially so a partial failure leaves a clear,
 * per-row audit trail (and doesn't hammer the funded testnet key in parallel).
 */
export async function createPoolBatch(
  tenantId: string,
  createdByUserId: string,
  input: PoolBatchInput,
): Promise<PoolBatchResult> {
  const db = forTenant(tenantId);
  const contractId = poolContractId();
  const claimUrl = `${env.APP_URL.replace(/\/$/, "")}/claim`;

  // Create the grouping batch up-front so child Payments can FK to it; counts
  // are reconciled to the successful rows after processing.
  const batch = await db.paymentBatch.create({
    data: {
      createdByUserId,
      count: 0,
      totalSourceAmount: "0",
    } as unknown as Prisma.PaymentBatchUncheckedCreateInput,
  });

  const results: BatchReceiverResult[] = [];
  let successCount = 0;
  let successTotal = 0;

  for (const receiver of input.receivers as PoolBatchReceiverInput[]) {
    const email = receiver.email ?? null;
    try {
      const deposit = await createPoolDeposit({ amount: receiver.amount });
      const intentId = newIntentId();

      const data = {
        batchId: batch.id,
        intentId,
        status: "PENDING",
        payoutMethod: "POOL_WALLET",
        sourceAsset: "XLM",
        sourceAmount: String(receiver.amount),
        targetCurrency: "XLM",
        corridorFrom: "XLM",
        corridorTo: "XLM",
        recipientRef: receiver.ref,
        shielded: true,
        poolCommitment: deposit.commitment,
      } as unknown as Prisma.PaymentUncheckedCreateInput;

      const payment = await db.payment.create({ data });

      successCount += 1;
      successTotal += receiver.amount;
      results.push({
        ok: true,
        ref: receiver.ref,
        email,
        amount: receiver.amount,
        paymentId: payment.id,
        intentId,
        note: deposit.note,
        commitment: deposit.commitment,
        claimUrl,
        poolContractId: contractId,
        deposit: { txHash: deposit.txHash, explorerUrl: deposit.explorerUrl },
      });
    } catch (err) {
      logger.error({ err, ref: receiver.ref, batchId: batch.id }, "batch disbursement failed");
      results.push({ ok: false, ref: receiver.ref, email, amount: receiver.amount, error: errText(err) });
    }
  }

  // Reconcile the batch roll-up to what actually landed.
  await db.paymentBatch.update({
    where: { id: batch.id },
    data: { count: successCount, totalSourceAmount: String(successTotal) },
  });

  logger.info(
    { batchId: batch.id, requested: input.receivers.length, succeeded: successCount },
    "pool batch processed",
  );

  return {
    batchId: batch.id,
    requested: input.receivers.length,
    count: successCount,
    totalSourceAmount: successTotal,
    poolContractId: contractId,
    claimUrl,
    results,
  };
}

import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { forTenant, prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";
import { aesEncrypt } from "@/lib/crypto/aes";
import { loadViewKey } from "@/lib/crypto/viewkey";
import { createClaimNotification } from "@/lib/receiver/notifications";
import { createPoolDeposit } from "@/lib/pool/service";
import { poolContractId } from "@/lib/pool/sync";
import type { PoolBatchInput, PoolBatchReceiverInput } from "@/lib/validation/pool";
import type { Prisma } from "@/lib/generated/prisma/client";

const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => b as unknown as Uint8Array<ArrayBuffer>;

/**
 * Shield the receiver/payout details under the tenant view key so the payer can
 * selectively re-reveal them later (P6 decrypt — the accountant story), reusing
 * the exact canonical payload shape the enclave/decrypt route reads
 * (sender/recipient/asset/amount). Returns null when the tenant has no view key.
 */
async function shieldDisbursement(
  viewKey: Buffer | null,
  tenantName: string,
  receiver: PoolBatchReceiverInput,
  intentId: string,
): Promise<{ encryptedPayload: Uint8Array<ArrayBuffer>; payloadNonce: Uint8Array<ArrayBuffer>; proofHash: string } | null> {
  if (!viewKey) return null;
  const payload = {
    sender: tenantName,
    recipient: receiver.ref,
    asset: "XLM",
    amount: String(receiver.amount),
    targetCurrency: "XLM",
    intentId,
  };
  const { ciphertext, nonce } = aesEncrypt(Buffer.from(JSON.stringify(payload), "utf8"), viewKey);
  const proofHash = "0x" + createHash("sha256").update(ciphertext).digest("hex");
  return { encryptedPayload: asBytes(ciphertext), payloadNonce: asBytes(nonce), proofHash };
}

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
  // #82 routing: true when the receiver's email matched an existing Trexure
  // account and an in-app claim notification was created. An off-platform
  // receiver (no match) gets `false` here — email delivery is the #81 follow-up.
  notifiedInApp: boolean;
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
 * Match a batch row's email to an existing Receiver account and, if found,
 * create the in-app claim notification (#82). Emails are matched normalized to
 * lowercase (receiver auth stores them lowercased). Returns whether an in-app
 * notification was created. Never throws — a failure here is logged and treated
 * as "not notified" so the disbursement itself still succeeds.
 */
async function notifyOnPlatformReceiver(email: string | null, paymentId: string): Promise<boolean> {
  if (!email) return false;
  try {
    const receiver = await prisma.receiver.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (!receiver) return false;
    await createClaimNotification(receiver.id, paymentId);
    return true;
  } catch (err) {
    logger.warn({ err, paymentId }, "in-app claim notification failed");
    return false;
  }
}

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

  // Tenant name + view key (for shielding receiver details) resolved once. The
  // view key is optional — a tenant without one simply gets unshielded rows.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const tenantName = tenant?.name ?? "";
  let viewKey: Buffer | null = null;
  try {
    viewKey = await loadViewKey(tenantId);
  } catch {
    viewKey = null;
  }

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
      const shielded = await shieldDisbursement(viewKey, tenantName, receiver, intentId);

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
        ...(shielded
          ? { encryptedPayload: shielded.encryptedPayload, payloadNonce: shielded.payloadNonce, proofHash: shielded.proofHash }
          : {}),
      } as unknown as Prisma.PaymentUncheckedCreateInput;

      const payment = await db.payment.create({ data });

      // #82: if this receiver's email matches an existing Trexure account,
      // surface the disbursement in their in-app inbox (on-platform routing).
      // Off-platform receivers fall through to email (#81). Never let a
      // notification hiccup fail an already-persisted disbursement.
      const notifiedInApp = await notifyOnPlatformReceiver(email, payment.id);

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
        notifiedInApp,
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

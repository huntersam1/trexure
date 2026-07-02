import "server-only";
import type { Job } from "bullmq";
import { prisma } from "../../lib/db";
import { env } from "../../lib/env";
import { getContractEvents } from "../../lib/stellar/client";
import { reconcileQueue, QUEUE } from "../../lib/queue";

export const MAX_WATCH_ATTEMPTS = 10;
export const MAX_BACKOFF_MS = 60_000;

export function watchOnchainBackoff(attemptsMade: number): number {
  return Math.min(2 ** attemptsMade * 1000, MAX_BACKOFF_MS);
}

export async function processWatchOnchain(job: Job<{ paymentId: string }>): Promise<void> {
  const { paymentId } = job.data;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { legs: true },
  });
  if (!payment) return;
  if (payment.status === "SETTLED" || payment.status === "FAILED") return;

  const existing = payment.legs.find((l) => l.legType === "ONCHAIN");
  const contractId = existing?.contractId ?? env.ZK_CONTRACT_ID;
  const startLedger = existing?.ledger ?? 0;

  const events = await getContractEvents({
    contractId,
    topic: payment.intentId, // intent id is the on-chain join key, carried in the contract event topic/data (not a tx memo — Soroban rejects classic memos)
    startLedger,
  });
  const match = events[0];

  if (match) {
    await prisma.paymentLeg.upsert({
      where: { paymentId_legType: { paymentId, legType: "ONCHAIN" } },
      create: {
        paymentId,
        legType: "ONCHAIN",
        status: "CONFIRMED",
        txHash: match.txHash,
        ledger: match.ledger,
        contractId,
      },
      update: { status: "CONFIRMED", txHash: match.txHash, ledger: match.ledger },
    });
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: "ONCHAIN_CONFIRMED", proofHash: match.proofHash },
    });
    await reconcileQueue.add(QUEUE.RECONCILE, { paymentId });
    return;
  }

  // No matching event yet.
  if (job.attemptsMade + 1 >= MAX_WATCH_ATTEMPTS) {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } });
    return;
  }
  throw new Error(
    `watch-onchain: no event for intent ${payment.intentId} (attempt ${job.attemptsMade + 1})`,
  );
}

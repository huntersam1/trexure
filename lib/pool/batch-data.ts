import "server-only";

import { prisma } from "@/lib/db";
import type { PaymentStatus } from "@/lib/ui/types";

/**
 * Read model for the batch payment-details surface (P6, #88). Tenant-scoped via
 * an explicit `tenantId` filter (PaymentBatch groups tenant-owned Payments).
 */

export type BatchRollup = Record<PaymentStatus, number>;

const emptyRollup = (): BatchRollup => ({
  DRAFT: 0,
  PENDING: 0,
  ONCHAIN_CONFIRMED: 0,
  RECONCILING: 0,
  SETTLED: 0,
  FAILED: 0,
});

function rollupOf(statuses: string[]): BatchRollup {
  const r = emptyRollup();
  for (const s of statuses) r[s as PaymentStatus] = (r[s as PaymentStatus] ?? 0) + 1;
  return r;
}

export type BatchListItem = {
  id: string;
  createdAt: string;
  createdByUsername: string;
  count: number;
  totalSourceAmount: string;
  rollup: BatchRollup;
};

export async function listPoolBatches(tenantId: string): Promise<BatchListItem[]> {
  const batches = await prisma.paymentBatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { createdBy: { select: { username: true } }, payments: { select: { status: true } } },
  });
  return batches.map((b) => ({
    id: b.id,
    createdAt: b.createdAt.toISOString(),
    createdByUsername: b.createdBy?.username ?? "—",
    count: b.count,
    totalSourceAmount: b.totalSourceAmount.toString(),
    rollup: rollupOf(b.payments.map((p) => p.status)),
  }));
}

export type BatchChild = {
  id: string;
  recipientRef: string;
  sourceAmount: string;
  sourceAsset: string;
  targetCurrency: string;
  status: PaymentStatus;
  payoutMethod: string | null;
  hasReceipt: boolean;
  onchainTx: string | null;
  fiatBankRef: string | null;
};

export type BatchDetail = {
  id: string;
  createdAt: string;
  createdByUsername: string;
  count: number;
  totalSourceAmount: string;
  rollup: BatchRollup;
  children: BatchChild[];
};

export async function getPoolBatchDetail(tenantId: string, batchId: string): Promise<BatchDetail | null> {
  const b = await prisma.paymentBatch.findFirst({
    where: { id: batchId, tenantId },
    include: {
      createdBy: { select: { username: true } },
      payments: {
        orderBy: { createdAt: "asc" },
        include: { legs: true, receipt: { select: { id: true } } },
      },
    },
  });
  if (!b) return null;

  return {
    id: b.id,
    createdAt: b.createdAt.toISOString(),
    createdByUsername: b.createdBy?.username ?? "—",
    count: b.count,
    totalSourceAmount: b.totalSourceAmount.toString(),
    rollup: rollupOf(b.payments.map((p) => p.status)),
    children: b.payments.map((p) => ({
      id: p.id,
      recipientRef: p.recipientRef,
      sourceAmount: p.sourceAmount.toString(),
      sourceAsset: p.sourceAsset,
      targetCurrency: p.targetCurrency,
      status: p.status as PaymentStatus,
      payoutMethod: p.payoutMethod,
      hasReceipt: p.receipt != null,
      onchainTx: p.legs.find((l) => l.legType === "ONCHAIN")?.txHash ?? null,
      fiatBankRef: p.legs.find((l) => l.legType === "FIAT")?.bankRef ?? null,
    })),
  };
}

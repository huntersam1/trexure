import "server-only";
import { requireSession } from "@/lib/auth/session";
import { forTenant } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentDetail, PaymentStatus, PaymentSummary, Receipt } from "@/lib/ui/types";

function settledAt(p: { status: string; updatedAt: Date }): string | null {
  return p.status === "SETTLED" ? p.updatedAt.toISOString() : null;
}

function toSummary(p: {
  id: string;
  status: string;
  sourceAsset: string;
  sourceAmount: { toString(): string };
  targetCurrency: string;
  corridorFrom: string;
  corridorTo: string;
  createdAt: Date;
  updatedAt: Date;
}): PaymentSummary {
  return {
    id: p.id,
    status: p.status as PaymentStatus,
    sourceAsset: p.sourceAsset,
    sourceAmount: p.sourceAmount.toString(),
    targetCurrency: p.targetCurrency,
    corridorFrom: p.corridorFrom,
    corridorTo: p.corridorTo,
    createdAt: p.createdAt.toISOString(),
    settledAt: settledAt(p),
  };
}

export async function listPayments(opts: {
  status?: PaymentStatus;
  corridor?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: PaymentSummary[]; nextCursor: string | null }> {
  const user = await requireSession();
  const db = forTenant(user.tenantId);
  const take = Math.min(opts.limit ?? 20, 50);

  const where: Prisma.PaymentWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.corridor) {
    const [from, to] = opts.corridor.split("→");
    if (from) where.corridorFrom = from;
    if (to) where.corridorTo = to;
  }

  const rows = await db.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    items: page.map(toSummary),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export async function getPaymentDetail(id: string): Promise<PaymentDetail | null> {
  const user = await requireSession();
  const db = forTenant(user.tenantId);
  const p = await db.payment.findUnique({ where: { id }, include: { legs: true, receipt: true } });
  if (!p) return null;
  return {
    id: p.id,
    intentId: p.intentId,
    status: p.status as PaymentStatus,
    shielded: p.shielded,
    proofHash: p.proofHash,
    encryptedPayloadB64: p.encryptedPayload ? Buffer.from(p.encryptedPayload).toString("base64") : null,
    sourceAsset: p.sourceAsset,
    sourceAmount: p.sourceAmount.toString(),
    targetCurrency: p.targetCurrency,
    targetAmount: p.targetAmount ? p.targetAmount.toString() : null,
    corridorFrom: p.corridorFrom,
    corridorTo: p.corridorTo,
    createdAt: p.createdAt.toISOString(),
    legs: p.legs.map((l) => ({
      legType: l.legType as "ONCHAIN" | "FIAT",
      status: l.status as "PENDING" | "RECEIVED" | "CONFIRMED" | "FAILED",
      txHash: l.txHash,
      ledger: l.ledger,
      contractId: l.contractId,
      provider: l.provider,
      providerRef: l.providerRef,
      bankRef: l.bankRef,
      amount: l.amount ? l.amount.toString() : null,
      currency: l.currency,
    })),
    hasReceipt: p.receipt != null,
  };
}

export async function getDashboardKpis(): Promise<{
  volumeSettled: string;
  pendingCount: number;
  avgSettlementMins: string;
  recent: PaymentSummary[];
}> {
  const user = await requireSession();
  const db = forTenant(user.tenantId);

  // Settlement-time average is sampled over the most-recent window rather than
  // every settled row ever (#143 H4): a timestamp-difference average has no
  // Prisma `_avg` (and we don't want raw SQL), so bounding the sample keeps this
  // — the most-hit page — from scanning linearly-growing history forever.
  const AVG_WINDOW = 200;

  const [agg, pendingCount, recent, recentSettled] = await Promise.all([
    // Sum in the DB (exact, bounded) instead of pulling every settled row and
    // reducing with `Number(...)` in JS — that both scanned unboundedly and
    // accumulated money as a float.
    db.payment.aggregate({ where: { status: "SETTLED" }, _sum: { sourceAmount: true } }),
    db.payment.count({ where: { status: { in: ["PENDING", "RECONCILING", "ONCHAIN_CONFIRMED"] } } }),
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.payment.findMany({
      where: { status: "SETTLED" },
      orderBy: { updatedAt: "desc" },
      take: AVG_WINDOW,
      select: { createdAt: true, updatedAt: true },
    }),
  ]);

  const volume = agg._sum.sourceAmount ? Number(agg._sum.sourceAmount) : 0;
  const avgMins =
    recentSettled.length === 0
      ? 0
      : recentSettled.reduce((acc, p) => acc + (p.updatedAt.getTime() - p.createdAt.getTime()) / 60000, 0) /
        recentSettled.length;

  return {
    volumeSettled: volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pendingCount,
    avgSettlementMins: avgMins.toFixed(1),
    recent: recent.map(toSummary),
  };
}

export async function getReceiptJson(paymentId: string): Promise<Receipt | null> {
  const user = await requireSession();
  const db = forTenant(user.tenantId);
  const r = await db.receipt.findUnique({ where: { paymentId } });
  if (!r) return null;
  return r.json as unknown as Receipt;
}

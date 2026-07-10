import "server-only";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { toCsv, csvRow, joinCsvBlocks, type CsvColumn } from "./csv";
import { renderReportPdf, type ReportDoc } from "./pdf";
import { rangeLabel, type DateRange } from "./scope";

const D = Prisma.Decimal;

/**
 * Disbursement / Payroll Register (R3). Payroll is many-to-many: a company pays a
 * roster of freelancers in one batch (#80). This is the register finance/HR keeps
 * — one row per child `Payment` (who was paid, how much, by which rail) plus the
 * actionable roll-up: **claimed vs. unclaimed vs. failed** per batch.
 *
 * Scoped to a single `PaymentBatch` (from the batch UI) or a date range across
 * batches (from `/reports`). Builds on R1's `lib/reports/{csv,pdf,scope}`.
 *
 * Claim state is derived from the child status: SETTLED = claimed & paid,
 * FAILED = failed (funds may be in custody for a POOL_BANK claim), everything
 * else (PENDING / ONCHAIN_CONFIRMED / RECONCILING) = sent-but-unclaimed.
 */

export type ClaimState = "claimed" | "unclaimed" | "failed";

export type PayrollRow = {
  batchId: string;
  paymentId: string;
  date: string; // ISO createdAt
  receiver: string; // recipientRef (stable receiver label)
  sourceAmount: string;
  sourceAsset: string;
  targetCurrency: string;
  targetAmount: string;
  payoutMethod: string; // POOL_WALLET | POOL_BANK | ""
  status: string;
  claimState: ClaimState;
  destination: string; // bank ref (POOL_BANK) or "on-chain wallet" (settled POOL_WALLET)
  depositCommitment: string; // public note commitment (deposit ref; deposit tx not persisted per-child)
  withdrawTx: string; // ONCHAIN leg tx = the claim/withdraw settlement tx
  receiptId: string;
};

export type CurrencyTotal = { currency: string; total: string };

export type PayrollBatchGroup = {
  batchId: string;
  createdAt: string;
  createdByUsername: string;
  count: number;
  totalSourceAmount: string;
  claimed: number;
  unclaimed: number;
  failed: number;
  rows: PayrollRow[];
};

export type PayrollTotals = {
  batchCount: number;
  disbursementCount: number;
  claimed: number;
  unclaimed: number;
  failed: number;
  totalBySymbol: CurrencyTotal[];
  claimedBySymbol: CurrencyTotal[];
};

export type PayrollRegister = {
  tenantId: string;
  scope: { batchId: string | null; range: { from: string; to: string } | null };
  generatedAt: string;
  batches: PayrollBatchGroup[];
  totals: PayrollTotals;
};

const BATCH_INCLUDE = {
  createdBy: { select: { username: true } },
  payments: {
    orderBy: { createdAt: "asc" },
    include: { legs: true, receipt: { select: { id: true, json: true } } },
  },
} satisfies Prisma.PaymentBatchInclude;

type BatchWithChildren = Prisma.PaymentBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;
type ChildPayment = BatchWithChildren["payments"][number];

function claimStateOf(status: string): ClaimState {
  if (status === "SETTLED") return "claimed";
  if (status === "FAILED") return "failed";
  return "unclaimed";
}

export function sumByCurrency(pairs: { currency: string; value: string }[]): CurrencyTotal[] {
  const acc = new Map<string, Prisma.Decimal>();
  for (const { currency, value } of pairs) {
    if (!currency || !value) continue;
    let amount: Prisma.Decimal;
    try {
      amount = new D(value);
    } catch {
      continue;
    }
    acc.set(currency, (acc.get(currency) ?? new D(0)).plus(amount));
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, total: total.toString() }));
}

function toRow(batchId: string, p: ChildPayment): PayrollRow {
  const onchain = p.legs.find((l) => l.legType === "ONCHAIN");
  const fiat = p.legs.find((l) => l.legType === "FIAT");
  const isBank = p.payoutMethod === "POOL_BANK";
  // The wallet destination address lives inside the withdraw tx (not persisted
  // separately); the bank destination is the fiat leg's bank ref.
  const destination = isBank ? (fiat?.bankRef ?? "") : p.status === "SETTLED" ? "on-chain wallet" : "";
  // Prefer the human receipt id stored in Receipt.json (what R1/R2 surface and
  // the customer holds); fall back to the row's DB id.
  const receiptId = p.receipt
    ? ((p.receipt.json as { id?: string } | null)?.id ?? p.receipt.id)
    : "";

  return {
    batchId,
    paymentId: p.id,
    date: p.createdAt.toISOString(),
    receiver: p.recipientRef,
    sourceAmount: p.sourceAmount.toString(),
    sourceAsset: p.sourceAsset,
    targetCurrency: p.targetCurrency,
    targetAmount: p.targetAmount ? p.targetAmount.toString() : "",
    payoutMethod: p.payoutMethod ?? "",
    status: p.status,
    claimState: claimStateOf(p.status),
    destination,
    depositCommitment: p.poolCommitment ?? "",
    withdrawTx: onchain?.txHash ?? "",
    receiptId,
  };
}

function groupOf(b: BatchWithChildren): PayrollBatchGroup {
  const rows = b.payments.map((p) => toRow(b.id, p));
  const claimed = rows.filter((r) => r.claimState === "claimed").length;
  const failed = rows.filter((r) => r.claimState === "failed").length;
  return {
    batchId: b.id,
    createdAt: b.createdAt.toISOString(),
    createdByUsername: b.createdBy?.username ?? "—",
    count: b.count,
    totalSourceAmount: b.totalSourceAmount.toString(),
    claimed,
    unclaimed: rows.length - claimed - failed,
    failed,
    rows,
  };
}

/**
 * Build a payroll register for a tenant, scoped to one batch (`batchId`) or a
 * date range across batches (`range`, on `PaymentBatch.createdAt`). Tenant-scoped
 * by an explicit `tenantId` filter (batches group tenant-owned payments).
 */
export async function buildPayrollRegister(
  tenantId: string,
  opts: { batchId?: string | null; range?: DateRange | null },
  now: Date = new Date(),
): Promise<PayrollRegister> {
  const batchId = opts.batchId?.trim() || null;
  const range = opts.range ?? null;

  const batchesRaw = batchId
    ? await prisma.paymentBatch.findMany({ where: { id: batchId, tenantId }, include: BATCH_INCLUDE })
    : await prisma.paymentBatch.findMany({
        where: { tenantId, ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: BATCH_INCLUDE,
      });

  const batches = batchesRaw.map(groupOf);
  const allRows = batches.flatMap((g) => g.rows);
  const claimedRows = allRows.filter((r) => r.claimState === "claimed");

  const totals: PayrollTotals = {
    batchCount: batches.length,
    disbursementCount: allRows.length,
    claimed: claimedRows.length,
    unclaimed: allRows.filter((r) => r.claimState === "unclaimed").length,
    failed: allRows.filter((r) => r.claimState === "failed").length,
    totalBySymbol: sumByCurrency(allRows.map((r) => ({ currency: r.sourceAsset, value: r.sourceAmount }))),
    claimedBySymbol: sumByCurrency(
      claimedRows.map((r) => ({ currency: r.sourceAsset, value: r.sourceAmount })),
    ),
  };

  return {
    tenantId,
    scope: {
      batchId,
      range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,
    },
    generatedAt: now.toISOString(),
    batches,
    totals,
  };
}

// ---- Renderers ------------------------------------------------------------

const ROW_COLUMNS: CsvColumn<PayrollRow>[] = [
  { header: "Batch ID", value: (r) => r.batchId },
  { header: "Date", value: (r) => r.date },
  { header: "Receiver", value: (r) => r.receiver },
  { header: "Amount", value: (r) => r.sourceAmount },
  { header: "Asset", value: (r) => r.sourceAsset },
  { header: "Target", value: (r) => (r.targetAmount ? `${r.targetAmount} ${r.targetCurrency}` : "") },
  { header: "Method", value: (r) => r.payoutMethod },
  { header: "Status", value: (r) => r.status },
  { header: "Claim State", value: (r) => r.claimState },
  { header: "Destination", value: (r) => r.destination },
  { header: "Withdraw Tx", value: (r) => r.withdrawTx },
  { header: "Deposit Commitment", value: (r) => r.depositCommitment },
  { header: "Receipt ID", value: (r) => r.receiptId },
];

export function payrollRegisterToCsv(reg: PayrollRegister): string {
  const rows = reg.batches.flatMap((g) => g.rows);
  const disbursements = `${csvRow(["# Disbursements"])}\r\n${toCsv(ROW_COLUMNS, rows)}`;
  const totals = [
    csvRow(["# Totals"]),
    csvRow(["Batches", String(reg.totals.batchCount)]),
    csvRow(["Disbursements", String(reg.totals.disbursementCount)]),
    csvRow(["Claimed", String(reg.totals.claimed)]),
    csvRow(["Unclaimed", String(reg.totals.unclaimed)]),
    csvRow(["Failed", String(reg.totals.failed)]),
    ...reg.totals.totalBySymbol.map((t) => csvRow([`Total (${t.currency})`, t.total])),
    ...reg.totals.claimedBySymbol.map((t) => csvRow([`Claimed total (${t.currency})`, t.total])),
  ].join("\r\n");
  return joinCsvBlocks([disbursements, totals]);
}

export function payrollRegisterToReportDoc(reg: PayrollRegister): ReportDoc {
  const rows = reg.batches.flatMap((g) => g.rows);
  const scopeLabel = reg.scope.batchId
    ? `Batch ${reg.scope.batchId}`
    : reg.scope.range
      ? rangeLabel({ from: new Date(reg.scope.range.from), to: new Date(reg.scope.range.to) })
      : "All batches";

  return {
    title: "Disbursement / Payroll Register",
    subtitle: `Tenant ${reg.tenantId} — ${scopeLabel}`,
    summary: [
      { label: "Scope", value: scopeLabel },
      { label: "Generated", value: reg.generatedAt },
      { label: "Batches", value: String(reg.totals.batchCount) },
      { label: "Disbursements", value: String(reg.totals.disbursementCount) },
      { label: "Claimed", value: String(reg.totals.claimed) },
      { label: "Unclaimed", value: String(reg.totals.unclaimed) },
      { label: "Failed", value: String(reg.totals.failed) },
      ...reg.totals.totalBySymbol.map((t) => ({ label: `Total ${t.currency}`, value: t.total })),
      ...reg.totals.claimedBySymbol.map((t) => ({ label: `Claimed ${t.currency}`, value: t.total })),
    ],
    tables: [
      {
        heading: "Disbursements",
        columns: ["Date", "Receiver", "Amount", "Method", "Status", "Claim", "Destination", "Withdraw Tx", "Receipt"],
        rows: rows.map((r) => [
          r.date.slice(0, 10),
          r.receiver,
          `${r.sourceAmount} ${r.sourceAsset}`,
          r.payoutMethod ? (r.payoutMethod === "POOL_BANK" ? "bank" : "wallet") : "",
          r.status,
          r.claimState,
          r.destination,
          r.withdrawTx,
          r.receiptId,
        ]),
      },
      {
        heading: "Batch roll-up",
        columns: ["Batch", "Created", "By", "Count", "Total", "Claimed", "Unclaimed", "Failed"],
        rows: reg.batches.map((g) => [
          g.batchId,
          g.createdAt.slice(0, 10),
          g.createdByUsername,
          String(g.count),
          `${g.totalSourceAmount} XLM`,
          String(g.claimed),
          String(g.unclaimed),
          String(g.failed),
        ]),
      },
    ],
  };
}

export function payrollRegisterToPdf(reg: PayrollRegister): Promise<Buffer> {
  return renderReportPdf(payrollRegisterToReportDoc(reg));
}

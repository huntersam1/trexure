import "server-only";
import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { toCsv, joinCsvBlocks, csvRow, type CsvColumn } from "./csv";
import { renderReportPdf, type ReportDoc } from "./pdf";
import { rangeLabel, type DateRange } from "./scope";

const D = Prisma.Decimal;

/**
 * Reconciliation / Settlement Statement (R1). A period export of every settled
 * payment for a tenant plus the exceptions finance chases (in-flight, failed,
 * funds-in-custody, on-chain-without-fiat drift). Numbers are pulled from the
 * stored `Receipt.json` when present so the statement never re-derives (and
 * therefore never drifts from) the receipt the customer already holds; missing
 * fields fall back to the `Payment` columns.
 *
 * Also lays the reusable reporting foundation: `lib/reports/{csv,pdf,scope}` are
 * report-agnostic and R2–R5 build on them the same way.
 */

export type ReconciliationRow = {
  paymentId: string;
  date: string; // ISO createdAt
  counterparty: string; // recipientRef
  corridor: string; // "FROM -> TO"
  sourceAsset: string;
  sourceAmount: string;
  targetCurrency: string;
  targetAmount: string;
  fxRate: string;
  fees: string;
  slippage: string;
  txHash: string;
  bankRef: string;
  receiptId: string;
  yieldAccrued: string; // Treasury Float Yield (#161 P4); "" when no yield position
};

export type ExceptionRow = {
  paymentId: string;
  date: string;
  counterparty: string;
  corridor: string;
  status: string;
  amount: string; // "<amount> <asset>"
  reason: string;
};

export type CurrencyTotal = { currency: string; total: string };

export type ReconciliationTotals = {
  settledCount: number;
  exceptionCount: number;
  sourceBySymbol: CurrencyTotal[];
  destinationByCurrency: CurrencyTotal[];
  yieldBySymbol: CurrencyTotal[]; // accrued yield across settled rows (#161 P4)
};

export type ReconciliationStatement = {
  tenantId: string;
  range: { from: string; to: string };
  generatedAt: string;
  settled: ReconciliationRow[];
  exceptions: ExceptionRow[];
  totals: ReconciliationTotals;
};

type ReceiptJson = {
  id?: string;
  amounts?: {
    source?: { currency?: string; value?: string };
    destination?: { currency?: string; value?: string };
  };
  fx?: { rate?: string };
  fees?: { network?: string; anchor?: string; platform?: string };
  slippage?: string;
  onchain?: { txHash?: string };
  fiat?: { bankRef?: string };
  yield?: { accrued?: string; netYield?: string; status?: string };
};

type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: { legs: true; receipt: true; yieldPosition: true };
}>;

function feesSummary(r: ReceiptJson): string {
  const f = r.fees;
  if (!f) return "";
  return [f.network, f.anchor, f.platform ? `platform ${f.platform}` : ""]
    .filter((x) => x && x.length > 0)
    .join("; ");
}

function exceptionReason(p: PaymentWithRelations): string {
  const onchain = p.legs.find((l) => l.legType === "ONCHAIN");
  const fiat = p.legs.find((l) => l.legType === "FIAT");
  let reason: string;
  switch (p.status) {
    case "FAILED":
      reason =
        p.payoutMethod === "POOL_BANK" && onchain?.status === "CONFIRMED"
          ? "Funds in custody — off-ramp failed (manual refund required)"
          : "Failed";
      break;
    case "PENDING":
      reason = "Awaiting on-chain confirmation";
      break;
    case "ONCHAIN_CONFIRMED":
      reason = "On-chain confirmed, awaiting fiat settlement";
      break;
    case "RECONCILING":
      reason = "Reconciling — matching fiat leg";
      break;
    case "DRAFT":
      reason = "Draft — not yet submitted";
      break;
    default:
      reason = p.status;
  }
  // On-chain-leg-without-fiat drift: an on-chain confirmation exists but no fiat
  // leg on a fiat-corridor (non-wallet) payment — the drift finance chases.
  if (
    p.status !== "SETTLED" &&
    p.payoutMethod !== "POOL_WALLET" &&
    onchain?.status === "CONFIRMED" &&
    !fiat
  ) {
    reason += " (on-chain leg without fiat leg)";
  }
  // Treasury Float Yield (#161 P4): flag idle balance still parked in yield.
  if (p.yieldPosition?.status === "SWEPT_IN") {
    reason += " (float still in yield position — not yet unwound)";
  }
  return reason;
}

/** The yield-drift reason for a payment whose position failed to unwind, or null. */
function yieldExceptionReason(p: PaymentWithRelations): string | null {
  if (p.yieldPosition?.status === "FAILED") {
    return "Yield unwind failed — disbursement served from liquid buffer (position needs reconcile)";
  }
  return null;
}

function toSettledRow(p: PaymentWithRelations): ReconciliationRow {
  const r = (p.receipt?.json ?? {}) as ReceiptJson;
  const onchainLeg = p.legs.find((l) => l.legType === "ONCHAIN");
  const fiatLeg = p.legs.find((l) => l.legType === "FIAT");

  const sourceAmount = r.amounts?.source?.value ?? p.sourceAmount.toString();
  const targetAmount =
    r.amounts?.destination?.value ?? (p.targetAmount ? p.targetAmount.toString() : "");

  return {
    paymentId: p.id,
    date: p.createdAt.toISOString(),
    counterparty: p.recipientRef,
    corridor: `${p.corridorFrom} -> ${p.corridorTo}`,
    sourceAsset: r.amounts?.source?.currency ?? p.sourceAsset,
    sourceAmount,
    targetCurrency: r.amounts?.destination?.currency ?? p.targetCurrency,
    targetAmount,
    fxRate: r.fx?.rate ?? "",
    fees: feesSummary(r),
    slippage: r.slippage ?? "",
    txHash: r.onchain?.txHash ?? onchainLeg?.txHash ?? "",
    bankRef: r.fiat?.bankRef ?? fiatLeg?.bankRef ?? "",
    receiptId: r.id ?? (p.receipt ? `rcpt_${p.id}` : ""),
    // Prefer the stored receipt's yield figure (no drift); fall back to the position.
    yieldAccrued: r.yield?.accrued ?? p.yieldPosition?.accruedYield?.toString() ?? "",
  };
}

function sumByCurrency(pairs: { currency: string; value: string }[]): CurrencyTotal[] {
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

export async function buildReconciliationStatement(
  tenantId: string,
  range: DateRange,
  now: Date = new Date(),
): Promise<ReconciliationStatement> {
  const db = forTenant(tenantId);
  const payments = (await db.payment.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    include: { legs: true, receipt: true, yieldPosition: true },
    orderBy: { createdAt: "asc" },
  })) as PaymentWithRelations[];

  const settledPayments = payments.filter((p) => p.status === "SETTLED");
  const exceptionPayments = payments.filter((p) => p.status !== "SETTLED");

  const settled = settledPayments.map(toSettledRow);
  const exceptions: ExceptionRow[] = exceptionPayments.map((p) => ({
    paymentId: p.id,
    date: p.createdAt.toISOString(),
    counterparty: p.recipientRef,
    corridor: `${p.corridorFrom} -> ${p.corridorTo}`,
    status: p.status,
    amount: `${p.sourceAmount.toString()} ${p.sourceAsset}`,
    reason: exceptionReason(p),
  }));

  // Treasury Float Yield (#161 P4): a settled payment whose yield unwind FAILED is
  // still a drift finance must reconcile (funds served from the buffer, position
  // stuck) — surface it even though the payment itself settled.
  for (const p of settledPayments) {
    const yieldReason = yieldExceptionReason(p);
    if (yieldReason) {
      exceptions.push({
        paymentId: p.id,
        date: p.createdAt.toISOString(),
        counterparty: p.recipientRef,
        corridor: `${p.corridorFrom} -> ${p.corridorTo}`,
        status: p.status,
        amount: `${p.yieldPosition?.principal.toString() ?? p.sourceAmount.toString()} ${p.sourceAsset}`,
        reason: yieldReason,
      });
    }
  }

  const totals: ReconciliationTotals = {
    settledCount: settled.length,
    exceptionCount: exceptions.length,
    sourceBySymbol: sumByCurrency(
      settled.map((r) => ({ currency: r.sourceAsset, value: r.sourceAmount })),
    ),
    destinationByCurrency: sumByCurrency(
      settled.map((r) => ({ currency: r.targetCurrency, value: r.targetAmount })),
    ),
    yieldBySymbol: sumByCurrency(
      settled
        .filter((r) => r.yieldAccrued)
        .map((r) => ({ currency: r.sourceAsset, value: r.yieldAccrued })),
    ),
  };

  return {
    tenantId,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    generatedAt: now.toISOString(),
    settled,
    exceptions,
    totals,
  };
}

// ---- Renderers ------------------------------------------------------------

const SETTLED_COLUMNS: CsvColumn<ReconciliationRow>[] = [
  { header: "Date", value: (r) => r.date },
  { header: "Payment ID", value: (r) => r.paymentId },
  { header: "Counterparty", value: (r) => r.counterparty },
  { header: "Corridor", value: (r) => r.corridor },
  { header: "Source Asset", value: (r) => r.sourceAsset },
  { header: "Source Amount", value: (r) => r.sourceAmount },
  { header: "Target Currency", value: (r) => r.targetCurrency },
  { header: "Target Amount", value: (r) => r.targetAmount },
  { header: "FX Rate", value: (r) => r.fxRate },
  { header: "Fees", value: (r) => r.fees },
  { header: "Slippage", value: (r) => r.slippage },
  { header: "On-chain Tx", value: (r) => r.txHash },
  { header: "Bank Ref", value: (r) => r.bankRef },
  { header: "Receipt ID", value: (r) => r.receiptId },
  { header: "Yield Accrued", value: (r) => r.yieldAccrued },
];

const EXCEPTION_COLUMNS: CsvColumn<ExceptionRow>[] = [
  { header: "Date", value: (r) => r.date },
  { header: "Payment ID", value: (r) => r.paymentId },
  { header: "Counterparty", value: (r) => r.counterparty },
  { header: "Corridor", value: (r) => r.corridor },
  { header: "Status", value: (r) => r.status },
  { header: "Amount", value: (r) => r.amount },
  { header: "Reason", value: (r) => r.reason },
];

export function reconciliationToCsv(stmt: ReconciliationStatement): string {
  const settledBlock = `${csvRow(["# Settled payments"])}\r\n${toCsv(SETTLED_COLUMNS, stmt.settled)}`;
  const exceptionsBlock = `${csvRow(["# Exceptions"])}\r\n${toCsv(EXCEPTION_COLUMNS, stmt.exceptions)}`;
  const totalsRows = [
    csvRow(["# Totals"]),
    csvRow(["Settled count", String(stmt.totals.settledCount)]),
    csvRow(["Exception count", String(stmt.totals.exceptionCount)]),
    ...stmt.totals.sourceBySymbol.map((t) => csvRow([`Source total (${t.currency})`, t.total])),
    ...stmt.totals.destinationByCurrency.map((t) =>
      csvRow([`Settled total (${t.currency})`, t.total]),
    ),
    ...stmt.totals.yieldBySymbol.map((t) => csvRow([`Yield accrued (${t.currency})`, t.total])),
  ].join("\r\n");

  return joinCsvBlocks([settledBlock, exceptionsBlock, totalsRows]);
}

export function reconciliationToReportDoc(stmt: ReconciliationStatement): ReportDoc {
  const summary = [
    { label: "Period", value: rangeLabel({ from: new Date(stmt.range.from), to: new Date(stmt.range.to) }) },
    { label: "Generated", value: stmt.generatedAt },
    { label: "Settled payments", value: String(stmt.totals.settledCount) },
    { label: "Exceptions", value: String(stmt.totals.exceptionCount) },
    ...stmt.totals.sourceBySymbol.map((t) => ({ label: `Source total ${t.currency}`, value: t.total })),
    ...stmt.totals.destinationByCurrency.map((t) => ({
      label: `Settled total ${t.currency}`,
      value: t.total,
    })),
    ...stmt.totals.yieldBySymbol.map((t) => ({ label: `Yield accrued ${t.currency}`, value: t.total })),
  ];

  return {
    title: "Reconciliation Statement",
    subtitle: `Tenant ${stmt.tenantId}`,
    summary,
    tables: [
      {
        heading: "Settled payments",
        columns: ["Date", "Counterparty", "Corridor", "Source", "Target", "FX", "Yield", "On-chain Tx", "Bank Ref"],
        rows: stmt.settled.map((r) => [
          r.date.slice(0, 10),
          r.counterparty,
          r.corridor,
          `${r.sourceAmount} ${r.sourceAsset}`,
          r.targetAmount ? `${r.targetAmount} ${r.targetCurrency}` : "",
          r.fxRate,
          r.yieldAccrued,
          r.txHash,
          r.bankRef,
        ]),
      },
      {
        heading: "Exceptions",
        columns: ["Date", "Counterparty", "Corridor", "Status", "Amount", "Reason"],
        rows: stmt.exceptions.map((r) => [
          r.date.slice(0, 10),
          r.counterparty,
          r.corridor,
          r.status,
          r.amount,
          r.reason,
        ]),
      },
    ],
  };
}

export function reconciliationToPdf(stmt: ReconciliationStatement): Promise<Buffer> {
  return renderReportPdf(reconciliationToReportDoc(stmt));
}

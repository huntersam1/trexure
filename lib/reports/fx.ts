import "server-only";
import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { toCsv, csvRow, joinCsvBlocks, type CsvColumn } from "./csv";
import { renderReportPdf, type ReportDoc } from "./pdf";
import { rangeLabel, createdAtWithin, type DateRange } from "./scope";

const D = Prisma.Decimal;

/**
 * FX Realized Gain/Loss & Fees Summary (R5) — the treasury/tax view. For a period,
 * over every settled payment that off-ramped to fiat (a FIAT leg — POOL_BANK /
 * anchor payouts), what rate it realized, the fees/spread, and the aggregate.
 *
 * Figures are read from the **stored fiat `Receipt.json`** (destination amount,
 * realized `fx.rate`, `fees`, `slippage`) — never recomputed — with the
 * intent-time quote (`Payment.targetAmount`) as the reference. Realized gain/loss
 * = realized fiat − reference fiat, surfaced per payment and per corridor so tax
 * can pick its basis. Pool-wallet (XLM→XLM, no FIAT leg) settlements are excluded
 * — there is no FX. Builds on R1's `lib/reports/{csv,pdf,scope}`.
 */

export type FxRow = {
  paymentId: string;
  date: string; // ISO createdAt
  counterparty: string;
  corridor: string; // "FROM -> TO"
  sourceAsset: string;
  sourceAmount: string;
  targetCurrency: string;
  realizedAmount: string; // fiat actually paid out (receipt destination)
  realizedRate: string; // realized rate (receipt fx.rate)
  referenceAmount: string; // quote at intent (Payment.targetAmount)
  referenceRate: string; // reference rate = referenceAmount / sourceAmount
  gainLoss: string; // realizedAmount - referenceAmount (signed, target currency)
  anchorFee: string; // numeric, target currency
  networkFee: string; // numeric, source asset (XLM)
  slippage: string;
  txHash: string;
  bankRef: string;
};

export type FxAggregate = {
  corridor: string; // "SOURCE -> TARGET"
  sourceAsset: string;
  targetCurrency: string;
  count: number;
  totalSource: string;
  totalRealizedFiat: string;
  totalReferenceFiat: string;
  totalAnchorFees: string;
  totalNetworkFees: string;
  weightedAvgRealizedRate: string; // totalRealizedFiat / totalSource
  weightedAvgReferenceRate: string; // totalReferenceFiat / totalSource
  totalGainLoss: string; // totalRealizedFiat - totalReferenceFiat
};

export type FxSummary = {
  tenantId: string;
  range: { from: string; to: string };
  generatedAt: string;
  rows: FxRow[];
  aggregates: FxAggregate[];
  paymentCount: number;
};

type ReceiptJson = {
  id?: string;
  rail?: string;
  amounts?: {
    source?: { currency?: string; value?: string };
    destination?: { currency?: string; value?: string };
  };
  fx?: { rate?: string };
  fees?: { network?: string; anchor?: string; platform?: string };
  slippage?: string;
  onchain?: { txHash?: string };
  fiat?: { bankRef?: string };
};

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: { legs: true; receipt: true } }>;

/** Extract the first numeric token from a formatted fee string (e.g. "PHP 50.00", "0.00041 XLM"). */
function parseNum(s: string | undefined | null): Prisma.Decimal {
  if (!s) return new D(0);
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return new D(0);
  try {
    return new D(m[0]);
  } catch {
    return new D(0);
  }
}

function safeDec(s: string | undefined | null): Prisma.Decimal {
  if (!s) return new D(0);
  try {
    return new D(s);
  } catch {
    return new D(0);
  }
}

function toRow(p: PaymentWithRelations): FxRow {
  const r = (p.receipt?.json ?? {}) as ReceiptJson;
  const onchainLeg = p.legs.find((l) => l.legType === "ONCHAIN");
  const fiatLeg = p.legs.find((l) => l.legType === "FIAT");

  const sourceAmount = r.amounts?.source?.value ?? p.sourceAmount.toString();
  const realizedAmount =
    r.amounts?.destination?.value ??
    (fiatLeg?.amount ? fiatLeg.amount.toString() : p.targetAmount ? p.targetAmount.toString() : "0");
  const referenceAmount = p.targetAmount ? p.targetAmount.toString() : realizedAmount;

  const src = safeDec(sourceAmount);
  const realized = safeDec(realizedAmount);
  const reference = safeDec(referenceAmount);
  const referenceRate = src.gt(0) ? reference.div(src).toFixed(6) : "0";

  return {
    paymentId: p.id,
    date: p.createdAt.toISOString(),
    counterparty: p.recipientRef,
    corridor: `${p.corridorFrom} -> ${p.corridorTo}`,
    sourceAsset: r.amounts?.source?.currency ?? p.sourceAsset,
    sourceAmount,
    targetCurrency: r.amounts?.destination?.currency ?? p.targetCurrency,
    realizedAmount,
    realizedRate: r.fx?.rate ?? (src.gt(0) ? realized.div(src).toFixed(6) : "0"),
    referenceAmount,
    referenceRate,
    gainLoss: realized.minus(reference).toString(),
    anchorFee: parseNum(r.fees?.anchor).toString(),
    networkFee: parseNum(r.fees?.network).toString(),
    slippage: r.slippage ?? "",
    txHash: r.onchain?.txHash ?? onchainLeg?.txHash ?? "",
    bankRef: r.fiat?.bankRef ?? fiatLeg?.bankRef ?? "",
  };
}

function aggregate(rows: FxRow[]): FxAggregate[] {
  const groups = new Map<string, FxRow[]>();
  for (const row of rows) {
    const key = `${row.sourceAsset} -> ${row.targetCurrency}`;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([corridor, group]) => {
      const totalSource = group.reduce((a, r) => a.plus(safeDec(r.sourceAmount)), new D(0));
      const totalRealizedFiat = group.reduce((a, r) => a.plus(safeDec(r.realizedAmount)), new D(0));
      const totalReferenceFiat = group.reduce((a, r) => a.plus(safeDec(r.referenceAmount)), new D(0));
      const totalAnchorFees = group.reduce((a, r) => a.plus(safeDec(r.anchorFee)), new D(0));
      const totalNetworkFees = group.reduce((a, r) => a.plus(safeDec(r.networkFee)), new D(0));
      return {
        corridor,
        sourceAsset: group[0]!.sourceAsset,
        targetCurrency: group[0]!.targetCurrency,
        count: group.length,
        totalSource: totalSource.toString(),
        totalRealizedFiat: totalRealizedFiat.toString(),
        totalReferenceFiat: totalReferenceFiat.toString(),
        totalAnchorFees: totalAnchorFees.toString(),
        totalNetworkFees: totalNetworkFees.toString(),
        weightedAvgRealizedRate: totalSource.gt(0) ? totalRealizedFiat.div(totalSource).toFixed(6) : "0",
        weightedAvgReferenceRate: totalSource.gt(0) ? totalReferenceFiat.div(totalSource).toFixed(6) : "0",
        totalGainLoss: totalRealizedFiat.minus(totalReferenceFiat).toString(),
      };
    });
}

export async function buildFxSummary(
  tenantId: string,
  range: DateRange,
  now: Date = new Date(),
): Promise<FxSummary> {
  const db = forTenant(tenantId);
  const payments = (await db.payment.findMany({
    where: { status: "SETTLED", ...createdAtWithin(range) },
    include: { legs: true, receipt: true },
    orderBy: { createdAt: "asc" },
  })) as PaymentWithRelations[];

  // FX only exists where the payment off-ramped to fiat — a FIAT leg. Pool-wallet
  // (XLM->XLM) settlements have none and are excluded.
  const fiatPayments = payments.filter((p) => p.legs.some((l) => l.legType === "FIAT"));
  const rows = fiatPayments.map(toRow);

  return {
    tenantId,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    generatedAt: now.toISOString(),
    rows,
    aggregates: aggregate(rows),
    paymentCount: rows.length,
  };
}

// ---- Renderers ------------------------------------------------------------

const ROW_COLUMNS: CsvColumn<FxRow>[] = [
  { header: "Date", value: (r) => r.date },
  { header: "Payment ID", value: (r) => r.paymentId },
  { header: "Counterparty", value: (r) => r.counterparty },
  { header: "Corridor", value: (r) => r.corridor },
  { header: "Source Amount", value: (r) => r.sourceAmount },
  { header: "Source Asset", value: (r) => r.sourceAsset },
  { header: "Target Currency", value: (r) => r.targetCurrency },
  { header: "Realized Amount", value: (r) => r.realizedAmount },
  { header: "Realized Rate", value: (r) => r.realizedRate },
  { header: "Reference Amount", value: (r) => r.referenceAmount },
  { header: "Reference Rate", value: (r) => r.referenceRate },
  { header: "Gain/Loss", value: (r) => r.gainLoss },
  { header: "Anchor Fee", value: (r) => r.anchorFee },
  { header: "Network Fee", value: (r) => r.networkFee },
  { header: "Slippage", value: (r) => r.slippage },
  { header: "On-chain Tx", value: (r) => r.txHash },
  { header: "Bank Ref", value: (r) => r.bankRef },
];

export function fxSummaryToCsv(summary: FxSummary): string {
  const rowsBlock = `${csvRow(["# FX per payment"])}\r\n${toCsv(ROW_COLUMNS, summary.rows)}`;
  const aggRows = [
    csvRow(["# Aggregates by corridor"]),
    csvRow([
      "Corridor",
      "Count",
      "Total Source",
      "Total Realized",
      "Total Reference",
      "Total Anchor Fees",
      "Total Network Fees",
      "Wtd Avg Realized Rate",
      "Wtd Avg Reference Rate",
      "Total Gain/Loss",
    ]),
    ...summary.aggregates.map((a) =>
      csvRow([
        a.corridor,
        String(a.count),
        a.totalSource,
        a.totalRealizedFiat,
        a.totalReferenceFiat,
        a.totalAnchorFees,
        a.totalNetworkFees,
        a.weightedAvgRealizedRate,
        a.weightedAvgReferenceRate,
        a.totalGainLoss,
      ]),
    ),
  ].join("\r\n");
  return joinCsvBlocks([rowsBlock, aggRows]);
}

export function fxSummaryToReportDoc(summary: FxSummary): ReportDoc {
  const summaryLines = [
    {
      label: "Period",
      value: rangeLabel({ from: new Date(summary.range.from), to: new Date(summary.range.to) }),
    },
    { label: "Generated", value: summary.generatedAt },
    { label: "Fiat payments", value: String(summary.paymentCount) },
    ...summary.aggregates.flatMap((a) => [
      { label: `${a.corridor} realized`, value: `${a.totalRealizedFiat} ${a.targetCurrency}` },
      { label: `${a.corridor} wtd-avg rate`, value: a.weightedAvgRealizedRate },
      { label: `${a.corridor} gain/loss`, value: `${a.totalGainLoss} ${a.targetCurrency}` },
    ]),
  ];

  return {
    title: "FX Realized Gain/Loss & Fees Summary",
    subtitle: `Tenant ${summary.tenantId}`,
    summary: summaryLines,
    tables: [
      {
        heading: "Per payment",
        columns: ["Date", "Counterparty", "Source", "Realized", "Rate", "Reference", "Gain/Loss", "Anchor Fee"],
        rows: summary.rows.map((r) => [
          r.date.slice(0, 10),
          r.counterparty,
          `${r.sourceAmount} ${r.sourceAsset}`,
          `${r.realizedAmount} ${r.targetCurrency}`,
          r.realizedRate,
          `${r.referenceAmount} ${r.targetCurrency}`,
          r.gainLoss,
          `${r.anchorFee} ${r.targetCurrency}`,
        ]),
      },
      {
        heading: "Aggregates by corridor",
        columns: ["Corridor", "Count", "Total Source", "Total Realized", "Wtd Avg Rate", "Total Fees", "Gain/Loss"],
        rows: summary.aggregates.map((a) => [
          a.corridor,
          String(a.count),
          a.totalSource,
          `${a.totalRealizedFiat} ${a.targetCurrency}`,
          a.weightedAvgRealizedRate,
          `${a.totalAnchorFees} ${a.targetCurrency}`,
          `${a.totalGainLoss} ${a.targetCurrency}`,
        ]),
      },
    ],
  };
}

export function fxSummaryToPdf(summary: FxSummary): Promise<Buffer> {
  return renderReportPdf(fxSummaryToReportDoc(summary));
}

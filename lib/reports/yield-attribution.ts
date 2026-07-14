import "server-only";
import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { toCsv, joinCsvBlocks, csvRow, type CsvColumn } from "./csv";
import { renderReportPdf, type ReportDoc } from "./pdf";
import { rangeLabel, type DateRange } from "./scope";

/**
 * Treasury Float Yield — Yield Attribution report (#161 P6). Per-tenant view of
 * every yield position in a period: how much idle balance was swept, the yield it
 * earned, the platform management fee taken, and the net attributed to the tenant.
 * Figures come straight from the stored `YieldPosition` (the fee is recorded at
 * sweep-out) so the report never re-derives / drifts. Reuses the R1–R5 reporting
 * foundation (`lib/reports/{csv,pdf,scope}`).
 */

const D = Prisma.Decimal;

export type YieldAttributionRow = {
  paymentId: string;
  date: string;
  counterparty: string;
  asset: string;
  status: string;
  principal: string;
  accrued: string;
  feeBps: string;
  platformFee: string;
  netYield: string;
  sweepInTx: string;
  sweepOutTx: string;
};

export type YieldAssetTotal = {
  asset: string;
  principal: string;
  accrued: string;
  platformFee: string;
  netYield: string;
};

export type YieldAttributionTotals = {
  positionCount: number;
  activeCount: number; // SWEPT_IN
  unwoundCount: number; // SWEPT_OUT
  failedCount: number; // FAILED (buffer fallback)
  byAsset: YieldAssetTotal[];
};

export type YieldAttributionReport = {
  tenantId: string;
  range: { from: string; to: string };
  generatedAt: string;
  rows: YieldAttributionRow[];
  totals: YieldAttributionTotals;
};

type PositionWithPayment = Prisma.YieldPositionGetPayload<{
  include: { payment: { select: { recipientRef: true } } };
}>;

function toRow(p: PositionWithPayment): YieldAttributionRow {
  const accrued = new D(p.accruedYield.toString());
  const fee = new D(p.feeAmount.toString());
  return {
    paymentId: p.paymentId,
    date: p.createdAt.toISOString(),
    counterparty: p.payment?.recipientRef ?? "",
    asset: p.yieldAsset,
    status: p.status,
    principal: new D(p.principal.toString()).toFixed(2),
    accrued: accrued.toFixed(8),
    feeBps: p.feeBps.toString(),
    platformFee: fee.toFixed(8),
    netYield: accrued.minus(fee).toFixed(8),
    sweepInTx: p.sweepInTxHash ?? "",
    sweepOutTx: p.sweepOutTxHash ?? "",
  };
}

export async function buildYieldAttribution(
  tenantId: string,
  range: DateRange,
  now: Date = new Date(),
): Promise<YieldAttributionReport> {
  const db = forTenant(tenantId);
  const positions = (await db.yieldPosition.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    include: { payment: { select: { recipientRef: true } } },
    orderBy: { createdAt: "asc" },
  })) as PositionWithPayment[];

  const rows = positions.map(toRow);

  const acc = new Map<string, { principal: Prisma.Decimal; accrued: Prisma.Decimal; fee: Prisma.Decimal }>();
  for (const r of rows) {
    const cur = acc.get(r.asset) ?? { principal: new D(0), accrued: new D(0), fee: new D(0) };
    cur.principal = cur.principal.plus(r.principal);
    cur.accrued = cur.accrued.plus(r.accrued);
    cur.fee = cur.fee.plus(r.platformFee);
    acc.set(r.asset, cur);
  }
  const byAsset: YieldAssetTotal[] = [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asset, t]) => ({
      asset,
      principal: t.principal.toFixed(2),
      accrued: t.accrued.toFixed(8),
      platformFee: t.fee.toFixed(8),
      netYield: t.accrued.minus(t.fee).toFixed(8),
    }));

  const totals: YieldAttributionTotals = {
    positionCount: rows.length,
    activeCount: rows.filter((r) => r.status === "SWEPT_IN").length,
    unwoundCount: rows.filter((r) => r.status === "SWEPT_OUT").length,
    failedCount: rows.filter((r) => r.status === "FAILED").length,
    byAsset,
  };

  return {
    tenantId,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    generatedAt: now.toISOString(),
    rows,
    totals,
  };
}

// ---- Renderers ------------------------------------------------------------

const ROW_COLUMNS: CsvColumn<YieldAttributionRow>[] = [
  { header: "Date", value: (r) => r.date },
  { header: "Payment ID", value: (r) => r.paymentId },
  { header: "Counterparty", value: (r) => r.counterparty },
  { header: "Asset", value: (r) => r.asset },
  { header: "Status", value: (r) => r.status },
  { header: "Principal", value: (r) => r.principal },
  { header: "Accrued Yield", value: (r) => r.accrued },
  { header: "Fee (bps)", value: (r) => r.feeBps },
  { header: "Platform Fee", value: (r) => r.platformFee },
  { header: "Net Yield", value: (r) => r.netYield },
  { header: "Sweep-in Tx", value: (r) => r.sweepInTx },
  { header: "Sweep-out Tx", value: (r) => r.sweepOutTx },
];

export function yieldAttributionToCsv(report: YieldAttributionReport): string {
  const rowsBlock = `${csvRow(["# Yield positions"])}\r\n${toCsv(ROW_COLUMNS, report.rows)}`;
  const totalsRows = [
    csvRow(["# Totals"]),
    csvRow(["Positions", String(report.totals.positionCount)]),
    csvRow(["Active (in yield)", String(report.totals.activeCount)]),
    csvRow(["Unwound", String(report.totals.unwoundCount)]),
    csvRow(["Buffer fallbacks", String(report.totals.failedCount)]),
    ...report.totals.byAsset.flatMap((t) => [
      csvRow([`Principal swept (${t.asset})`, t.principal]),
      csvRow([`Accrued yield (${t.asset})`, t.accrued]),
      csvRow([`Platform fee (${t.asset})`, t.platformFee]),
      csvRow([`Net yield to tenant (${t.asset})`, t.netYield]),
    ]),
  ].join("\r\n");

  return joinCsvBlocks([rowsBlock, totalsRows]);
}

export function yieldAttributionToReportDoc(report: YieldAttributionReport): ReportDoc {
  const summary = [
    { label: "Period", value: rangeLabel({ from: new Date(report.range.from), to: new Date(report.range.to) }) },
    { label: "Generated", value: report.generatedAt },
    { label: "Positions", value: String(report.totals.positionCount) },
    { label: "In yield", value: String(report.totals.activeCount) },
    ...report.totals.byAsset.flatMap((t) => [
      { label: `Accrued ${t.asset}`, value: t.accrued },
      { label: `Platform fee ${t.asset}`, value: t.platformFee },
      { label: `Net yield ${t.asset}`, value: t.netYield },
    ]),
  ];

  return {
    title: "Yield Attribution",
    subtitle: `Tenant ${report.tenantId}`,
    summary,
    tables: [
      {
        heading: "Yield positions",
        columns: ["Date", "Counterparty", "Asset", "Status", "Principal", "Accrued", "Fee", "Net"],
        rows: report.rows.map((r) => [
          r.date.slice(0, 10),
          r.counterparty,
          r.asset,
          r.status,
          r.principal,
          r.accrued,
          r.platformFee,
          r.netYield,
        ]),
      },
    ],
  };
}

export function yieldAttributionToPdf(report: YieldAttributionReport): Promise<Buffer> {
  return renderReportPdf(yieldAttributionToReportDoc(report));
}

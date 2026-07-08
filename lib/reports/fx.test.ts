import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { buildFxSummary, fxSummaryToCsv, type FxSummary } from "./fx";
import type { DateRange } from "./scope";

const TENANT = "test_tenant_fx_r5";
const OTHER = "test_tenant_fx_r5_other";
const NOW = new Date("2026-07-31T23:59:59.999Z");

const RANGE: DateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};
const EMPTY_RANGE: DateRange = {
  from: new Date("2026-09-01T00:00:00.000Z"),
  to: new Date("2026-09-30T23:59:59.999Z"),
};
const IN_RANGE = new Date("2026-07-10T09:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-06-15T09:00:00.000Z");

type Leg = { legType: "ONCHAIN" | "FIAT"; status?: string; txHash?: string; bankRef?: string; amount?: string };

async function payment(opts: {
  tenantId: string;
  intent: string;
  status: string;
  createdAt?: Date;
  recipientRef?: string;
  sourceAmount?: string;
  targetAmount?: string; // quote at intent
  corridorTo?: string;
  legs?: Leg[];
  receiptJson?: Record<string, unknown>;
}): Promise<string> {
  const p = await prisma.payment.create({
    data: {
      tenantId: opts.tenantId,
      intentId: opts.intent,
      status: opts.status as never,
      createdAt: opts.createdAt ?? IN_RANGE,
      sourceAsset: "XLM",
      sourceAmount: opts.sourceAmount ?? "100",
      targetCurrency: opts.corridorTo ?? "PHP",
      targetAmount: opts.targetAmount ?? null,
      corridorFrom: "XLM",
      corridorTo: opts.corridorTo ?? "PHP",
      recipientRef: opts.recipientRef ?? `rcpt_${opts.intent}`,
      legs: opts.legs
        ? {
            create: opts.legs.map((l) => ({
              legType: l.legType as never,
              status: (l.status ?? "CONFIRMED") as never,
              txHash: l.txHash ?? null,
              bankRef: l.bankRef ?? null,
              amount: l.amount ?? null,
            })),
          }
        : undefined,
    } as never,
  });
  if (opts.receiptJson) {
    await prisma.receipt.create({ data: { paymentId: p.id, json: opts.receiptJson as never } });
  }
  return p.id;
}

let aId: string;

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `FX ${id}` } });
  }

  // A — settled fiat, realized gain (+6 PHP vs the intent quote).
  aId = await payment({
    tenantId: TENANT,
    intent: "fx_a",
    status: "SETTLED",
    recipientRef: "Acme Vendor",
    sourceAmount: "100",
    targetAmount: "624", // reference (quote at intent)
    legs: [
      { legType: "ONCHAIN", txHash: "tx_a" },
      { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-A", amount: "630" },
    ],
    receiptJson: {
      id: "rcpt_a",
      amounts: { source: { currency: "XLM", value: "100" }, destination: { currency: "PHP", value: "630" } },
      fx: { rate: "6.30" },
      fees: { network: "0.00041 XLM", anchor: "PHP 50.00", platform: "0.00" },
      slippage: "0.0096",
      onchain: { txHash: "tx_a" },
      fiat: { bankRef: "BANK-A" },
    },
  });

  // B — settled fiat, realized loss (−3 PHP vs the quote).
  await payment({
    tenantId: TENANT,
    intent: "fx_b",
    status: "SETTLED",
    recipientRef: "Beta LLC",
    sourceAmount: "50",
    targetAmount: "312",
    legs: [
      { legType: "ONCHAIN", txHash: "tx_b" },
      { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-B", amount: "309" },
    ],
    receiptJson: {
      id: "rcpt_b",
      amounts: { source: { currency: "XLM", value: "50" }, destination: { currency: "PHP", value: "309" } },
      fx: { rate: "6.18" },
      fees: { network: "0.00041 XLM", anchor: "PHP 25.00", platform: "0.00" },
      slippage: "0.0096",
      onchain: { txHash: "tx_b" },
      fiat: { bankRef: "BANK-B" },
    },
  });

  // C — settled pool-wallet (XLM->XLM, NO fiat leg): must be excluded (no FX).
  await payment({
    tenantId: TENANT,
    intent: "fx_pool",
    status: "SETTLED",
    corridorTo: "XLM",
    sourceAmount: "5",
    legs: [{ legType: "ONCHAIN", txHash: "tx_pool" }],
    receiptJson: { id: "rcpt_pool", rail: "pool-wallet", amounts: { source: { currency: "XLM", value: "5" }, destination: { currency: "XLM", value: "5" } }, onchain: { txHash: "tx_pool" } },
  });

  // D — pending (excluded), E — out of range (excluded), Other tenant (excluded).
  await payment({ tenantId: TENANT, intent: "fx_pending", status: "PENDING", legs: [{ legType: "FIAT", amount: "100" }] });
  await payment({
    tenantId: TENANT, intent: "fx_june", status: "SETTLED", createdAt: OUT_OF_RANGE,
    legs: [{ legType: "FIAT", amount: "100", bankRef: "BANK-JUNE" }],
    receiptJson: { amounts: { destination: { currency: "PHP", value: "100" } }, fiat: { bankRef: "BANK-JUNE" } },
  });
  await payment({
    tenantId: OTHER, intent: "fx_other", status: "SETTLED", recipientRef: "Secret",
    legs: [{ legType: "FIAT", amount: "999", bankRef: "BANK-OTHER" }],
    receiptJson: { amounts: { destination: { currency: "PHP", value: "999" } }, fiat: { bankRef: "BANK-OTHER" } },
  });
});

afterAll(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("buildFxSummary", () => {
  let summary: FxSummary;
  beforeAll(async () => {
    summary = await buildFxSummary(TENANT, RANGE, NOW);
  });

  it("includes only settled fiat payments (excludes pool-wallet, pending, out-of-range, other tenants)", () => {
    expect(summary.rows).toHaveLength(2);
    const corridors = summary.rows.map((r) => r.corridor);
    expect(corridors).not.toContain("XLM -> XLM");
    expect(summary.rows.map((r) => r.counterparty).sort()).toEqual(["Acme Vendor", "Beta LLC"]);
  });

  it("reads realized figures from the stored receipt and computes gain/loss vs the intent quote", () => {
    const a = summary.rows.find((r) => r.paymentId === aId)!;
    expect(a.realizedAmount).toBe("630");
    expect(a.realizedRate).toBe("6.30");
    expect(a.referenceAmount).toBe("624");
    expect(a.referenceRate).toBe("6.240000");
    expect(a.gainLoss).toBe("6");
    expect(a.anchorFee).toBe("50");
    expect(a.networkFee).toBe("0.00041");
    expect(a.bankRef).toBe("BANK-A");
  });

  it("aggregates per corridor: totals, weighted-average rate, and realized gain/loss", () => {
    expect(summary.aggregates).toHaveLength(1);
    const agg = summary.aggregates[0]!;
    expect(agg.corridor).toBe("XLM -> PHP");
    expect(agg.count).toBe(2);
    expect(agg.totalSource).toBe("150");
    expect(agg.totalRealizedFiat).toBe("939");
    expect(agg.totalReferenceFiat).toBe("936");
    expect(agg.totalGainLoss).toBe("3"); // +6 (A) − 3 (B)
    expect(agg.totalAnchorFees).toBe("75");
    expect(agg.weightedAvgRealizedRate).toBe("6.260000"); // 939 / 150
  });

  it("handles a zero-fiat period without dividing by zero", async () => {
    const empty = await buildFxSummary(TENANT, EMPTY_RANGE, NOW);
    expect(empty.rows).toHaveLength(0);
    expect(empty.aggregates).toHaveLength(0);
    expect(empty.paymentCount).toBe(0);
  });
});

describe("fxSummaryToCsv", () => {
  it("renders a stable, sectioned CSV snapshot", () => {
    const fixture: FxSummary = {
      tenantId: "t1",
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" },
      generatedAt: "2026-07-31T23:59:59.999Z",
      rows: [
        {
          paymentId: "p1", date: "2026-07-10T09:00:00.000Z", counterparty: "Acme Vendor", corridor: "XLM -> PHP",
          sourceAsset: "XLM", sourceAmount: "100", targetCurrency: "PHP",
          realizedAmount: "630", realizedRate: "6.30", referenceAmount: "624", referenceRate: "6.240000",
          gainLoss: "6", anchorFee: "50", networkFee: "0.00041", slippage: "0.0096",
          txHash: "tx_a", bankRef: "BANK-A",
        },
      ],
      aggregates: [
        {
          corridor: "XLM -> PHP", sourceAsset: "XLM", targetCurrency: "PHP", count: 1,
          totalSource: "100", totalRealizedFiat: "630", totalReferenceFiat: "624",
          totalAnchorFees: "50", totalNetworkFees: "0.00041",
          weightedAvgRealizedRate: "6.300000", weightedAvgReferenceRate: "6.240000", totalGainLoss: "6",
        },
      ],
      paymentCount: 1,
    };
    expect(fxSummaryToCsv(fixture)).toMatchInlineSnapshot(`
      "# FX per payment
      Date,Payment ID,Counterparty,Corridor,Source Amount,Source Asset,Target Currency,Realized Amount,Realized Rate,Reference Amount,Reference Rate,Gain/Loss,Anchor Fee,Network Fee,Slippage,On-chain Tx,Bank Ref
      2026-07-10T09:00:00.000Z,p1,Acme Vendor,XLM -> PHP,100,XLM,PHP,630,6.30,624,6.240000,6,50,0.00041,0.0096,tx_a,BANK-A

      # Aggregates by corridor
      Corridor,Count,Total Source,Total Realized,Total Reference,Total Anchor Fees,Total Network Fees,Wtd Avg Realized Rate,Wtd Avg Reference Rate,Total Gain/Loss
      XLM -> PHP,1,100,630,624,50,0.00041,6.300000,6.240000,6"
    `);
  });
});

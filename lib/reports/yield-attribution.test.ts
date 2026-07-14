import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import {
  buildYieldAttribution,
  yieldAttributionToCsv,
  type YieldAttributionReport,
} from "./yield-attribution";
import type { DateRange } from "./scope";

const TENANT = "test_tenant_yield_attr_p6";
const OTHER = "test_tenant_yield_attr_p6_other";
const RANGE: DateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};
const IN_RANGE = new Date("2026-07-10T09:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-06-10T09:00:00.000Z");
const NOW = new Date("2026-07-31T23:59:59.999Z");

async function pos(opts: {
  tenantId: string;
  intent: string;
  recipientRef: string;
  status: string;
  principal: string;
  accrued?: string;
  feeAmount?: string;
  feeBps?: string;
  createdAt?: Date;
  sweepInTx?: string;
  sweepOutTx?: string;
}): Promise<void> {
  const p = await prisma.payment.create({
    data: {
      tenantId: opts.tenantId, intentId: opts.intent, status: "PENDING",
      sourceAsset: "USDC", sourceAmount: opts.principal, targetCurrency: "PHP",
      corridorFrom: "USD", corridorTo: "PHP", recipientRef: opts.recipientRef,
    } as never,
  });
  await prisma.yieldPosition.create({
    data: {
      tenantId: opts.tenantId, paymentId: p.id, status: opts.status as never,
      principal: opts.principal, accruedYield: opts.accrued ?? "0", feeAmount: opts.feeAmount ?? "0",
      feeBps: opts.feeBps ?? "0", createdAt: opts.createdAt ?? IN_RANGE,
      sweepInTxHash: opts.sweepInTx ?? null, sweepOutTxHash: opts.sweepOutTx ?? null,
    } as never,
  });
}

let report: YieldAttributionReport;

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id } });
  }
  await pos({ tenantId: TENANT, intent: "attr_out", recipientRef: "Vendor A", status: "SWEPT_OUT", principal: "1000", accrued: "50", feeAmount: "0.125", feeBps: "25", sweepInTx: "in_1", sweepOutTx: "out_1" });
  await pos({ tenantId: TENANT, intent: "attr_in", recipientRef: "Vendor B", status: "SWEPT_IN", principal: "500", sweepInTx: "in_2" });
  await pos({ tenantId: TENANT, intent: "attr_failed", recipientRef: "Vendor C", status: "FAILED", principal: "300" });
  // Out of range (excluded) + other tenant (never appears).
  await pos({ tenantId: TENANT, intent: "attr_june", recipientRef: "Old", status: "SWEPT_OUT", principal: "9", accrued: "1", createdAt: OUT_OF_RANGE });
  await pos({ tenantId: OTHER, intent: "attr_other", recipientRef: "Other", status: "SWEPT_OUT", principal: "7", accrued: "2" });

  report = await buildYieldAttribution(TENANT, RANGE, NOW);
});

afterAll(async () => {
  await prisma.yieldPosition.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("buildYieldAttribution", () => {
  it("returns one row per in-range position, tenant-isolated, newest-last", () => {
    expect(report.rows).toHaveLength(3);
    const names = report.rows.map((r) => r.counterparty).sort();
    expect(names).toEqual(["Vendor A", "Vendor B", "Vendor C"]);
    expect(report.rows.some((r) => r.counterparty === "Other")).toBe(false);
    expect(report.rows.some((r) => r.counterparty === "Old")).toBe(false);
  });

  it("derives net yield = accrued − recorded platform fee per position", () => {
    const a = report.rows.find((r) => r.counterparty === "Vendor A")!;
    expect(a.accrued).toBe("50.00000000");
    expect(a.platformFee).toBe("0.12500000");
    expect(a.netYield).toBe("49.87500000");
    expect(a.feeBps).toBe("25");
    expect(a.sweepInTx).toBe("in_1");
    expect(a.sweepOutTx).toBe("out_1");
  });

  it("rolls up totals by asset + status counts", () => {
    expect(report.totals).toMatchObject({ positionCount: 3, activeCount: 1, unwoundCount: 1, failedCount: 1 });
    const ylds = report.totals.byAsset.find((t) => t.asset === "YLDS")!;
    expect(ylds.principal).toBe("1800.00");
    expect(ylds.accrued).toBe("50.00000000");
    expect(ylds.platformFee).toBe("0.12500000");
    expect(ylds.netYield).toBe("49.87500000");
  });
});

describe("yieldAttributionToCsv", () => {
  it("renders a stable, sectioned CSV snapshot", () => {
    const fixture: YieldAttributionReport = {
      tenantId: "t1",
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" },
      generatedAt: "2026-07-31T23:59:59.999Z",
      rows: [
        {
          paymentId: "p1", date: "2026-07-10T09:00:00.000Z", counterparty: "Vendor A", asset: "YLDS",
          status: "SWEPT_OUT", principal: "1000.00", accrued: "50.00000000", feeBps: "25",
          platformFee: "0.12500000", netYield: "49.87500000", sweepInTx: "in_1", sweepOutTx: "out_1",
        },
      ],
      totals: {
        positionCount: 1, activeCount: 0, unwoundCount: 1, failedCount: 0,
        byAsset: [{ asset: "YLDS", principal: "1000.00", accrued: "50.00000000", platformFee: "0.12500000", netYield: "49.87500000" }],
      },
    };
    expect(yieldAttributionToCsv(fixture)).toMatchInlineSnapshot(`
      "# Yield positions
      Date,Payment ID,Counterparty,Asset,Status,Principal,Accrued Yield,Fee (bps),Platform Fee,Net Yield,Sweep-in Tx,Sweep-out Tx
      2026-07-10T09:00:00.000Z,p1,Vendor A,YLDS,SWEPT_OUT,1000.00,50.00000000,25,0.12500000,49.87500000,in_1,out_1

      # Totals
      Positions,1
      Active (in yield),0
      Unwound,1
      Buffer fallbacks,0
      Principal swept (YLDS),1000.00
      Accrued yield (YLDS),50.00000000
      Platform fee (YLDS),0.12500000
      Net yield to tenant (YLDS),49.87500000"
    `);
  });
});

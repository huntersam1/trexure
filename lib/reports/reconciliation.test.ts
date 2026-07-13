import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import {
  buildReconciliationStatement,
  reconciliationToCsv,
  type ReconciliationStatement,
} from "./reconciliation";
import type { DateRange } from "./scope";

const TENANT = "test_tenant_recon_r1";
const OTHER = "test_tenant_recon_r1_other";

const RANGE: DateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};
const IN_RANGE = new Date("2026-07-10T09:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-06-15T09:00:00.000Z");
const NOW = new Date("2026-07-31T23:59:59.999Z");

type Leg = {
  legType: "ONCHAIN" | "FIAT";
  status?: "PENDING" | "RECEIVED" | "CONFIRMED" | "FAILED";
  txHash?: string;
  bankRef?: string;
};

async function payment(opts: {
  tenantId: string;
  intent: string;
  status: string;
  createdAt: Date;
  recipientRef?: string;
  corridorFrom?: string;
  corridorTo?: string;
  sourceAmount?: string;
  targetCurrency?: string;
  targetAmount?: string;
  payoutMethod?: string;
  legs?: Leg[];
  receiptJson?: Record<string, unknown>;
}): Promise<string> {
  const p = await prisma.payment.create({
    data: {
      tenantId: opts.tenantId,
      intentId: opts.intent,
      status: opts.status as never,
      createdAt: opts.createdAt,
      sourceAsset: "XLM",
      sourceAmount: opts.sourceAmount ?? "10",
      targetCurrency: opts.targetCurrency ?? "PHP",
      targetAmount: opts.targetAmount ?? null,
      corridorFrom: opts.corridorFrom ?? "XLM",
      corridorTo: opts.corridorTo ?? "PHP",
      recipientRef: opts.recipientRef ?? `rcpt_${opts.intent}`,
      payoutMethod: (opts.payoutMethod as never) ?? null,
      legs: opts.legs
        ? {
            create: opts.legs.map((l) => ({
              legType: l.legType as never,
              status: (l.status ?? "PENDING") as never,
              txHash: l.txHash ?? null,
              bankRef: l.bankRef ?? null,
            })),
          }
        : undefined,
    } as never,
  });
  if (opts.receiptJson) {
    await prisma.receipt.create({
      data: { paymentId: p.id, json: opts.receiptJson as never },
    });
  }
  return p.id;
}

let settledId: string;

beforeAll(async () => {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: "Recon HQ" } });
  await prisma.tenant.upsert({ where: { id: OTHER }, update: {}, create: { id: OTHER, name: "Other Co" } });

  // Settled fiat payment (in range) with a stored receipt — numbers come from it.
  settledId = await payment({
    tenantId: TENANT,
    intent: "recon_settled_1",
    status: "SETTLED",
    createdAt: IN_RANGE,
    recipientRef: "Acme Vendor",
    sourceAmount: "100",
    targetCurrency: "PHP",
    targetAmount: "5670",
    legs: [
      { legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_settled_1" },
      { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-REF-1" },
    ],
    receiptJson: {
      id: "rcpt_from_receipt",
      amounts: { source: { currency: "XLM", value: "100.00" }, destination: { currency: "PHP", value: "5670.00" } },
      fx: { rate: "56.70" },
      fees: { network: "0.00041 XLM", anchor: "PHP 50.00", platform: "0.00" },
      slippage: "0.0000",
      onchain: { txHash: "tx_settled_1" },
      fiat: { bankRef: "BANK-REF-1" },
    },
  });

  // Settled pool-wallet payment (in range), on-chain-only receipt (no fx/fiat).
  await payment({
    tenantId: TENANT,
    intent: "recon_settled_pool",
    status: "SETTLED",
    createdAt: IN_RANGE,
    recipientRef: "Freelancer A",
    sourceAmount: "5",
    corridorFrom: "XLM",
    corridorTo: "XLM",
    targetCurrency: "XLM",
    targetAmount: "5",
    payoutMethod: "POOL_WALLET",
    legs: [{ legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_pool_1" }],
    receiptJson: {
      id: "rcpt_pool",
      rail: "pool-wallet",
      amounts: { source: { currency: "XLM", value: "5.0000000" }, destination: { currency: "XLM", value: "5.0000000" } },
      onchain: { txHash: "tx_pool_1" },
    },
  });

  // Exceptions (in range).
  await payment({ tenantId: TENANT, intent: "recon_pending", status: "PENDING", createdAt: IN_RANGE });
  await payment({
    tenantId: TENANT,
    intent: "recon_custody",
    status: "FAILED",
    createdAt: IN_RANGE,
    payoutMethod: "POOL_BANK",
    legs: [{ legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_custody" }],
  });

  // Out-of-range settled payment (must be excluded).
  await payment({ tenantId: TENANT, intent: "recon_june", status: "SETTLED", createdAt: OUT_OF_RANGE });

  // Other tenant's settled payment (must never appear).
  await payment({ tenantId: OTHER, intent: "recon_other", status: "SETTLED", createdAt: IN_RANGE });
});

afterAll(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("buildReconciliationStatement", () => {
  let stmt: ReconciliationStatement;
  beforeAll(async () => {
    stmt = await buildReconciliationStatement(TENANT, RANGE, NOW);
  });

  it("splits settled rows from exceptions within the range", () => {
    expect(stmt.settled.map((r) => r.paymentId).sort()).toHaveLength(2);
    const intents = stmt.exceptions.map((e) => e.status).sort();
    expect(intents).toEqual(["FAILED", "PENDING"]);
  });

  it("excludes out-of-range payments", () => {
    const all = [...stmt.settled.map((r) => r.counterparty), ...stmt.exceptions.map((e) => e.counterparty)];
    expect(all).not.toContain("rcpt_recon_june");
  });

  it("is tenant-isolated — other tenants never appear", () => {
    const ids = [...stmt.settled.map((r) => r.paymentId), ...stmt.exceptions.map((e) => e.paymentId)];
    for (const id of ids) {
      expect(id).not.toBe("recon_other");
    }
    expect(stmt.settled.length + stmt.exceptions.length).toBe(4);
  });

  it("pulls settled figures from the stored receipt (no drift)", () => {
    const row = stmt.settled.find((r) => r.paymentId === settledId)!;
    expect(row.counterparty).toBe("Acme Vendor");
    expect(row.sourceAmount).toBe("100.00");
    expect(row.targetAmount).toBe("5670.00");
    expect(row.fxRate).toBe("56.70");
    expect(row.bankRef).toBe("BANK-REF-1");
    expect(row.receiptId).toBe("rcpt_from_receipt");
    expect(row.txHash).toBe("tx_settled_1");
  });

  it("handles the on-chain-only pool-wallet receipt shape (no fx/fiat)", () => {
    const row = stmt.settled.find((r) => r.corridor === "XLM -> XLM")!;
    expect(row.fxRate).toBe("");
    expect(row.bankRef).toBe("");
    expect(row.txHash).toBe("tx_pool_1");
  });

  it("flags funds-in-custody on a failed pool-bank claim", () => {
    const custody = stmt.exceptions.find((e) => e.status === "FAILED")!;
    expect(custody.reason).toContain("Funds in custody");
  });

  it("totals settled count and sums destinations per currency", () => {
    expect(stmt.totals.settledCount).toBe(2);
    expect(stmt.totals.exceptionCount).toBe(2);
    const php = stmt.totals.destinationByCurrency.find((t) => t.currency === "PHP");
    expect(php?.total).toBe("5670");
  });
});

describe("buildReconciliationStatement — treasury yield (#161 P4)", () => {
  const YT = "test_tenant_recon_yield_p4";
  let stmt: ReconciliationStatement;

  beforeAll(async () => {
    await prisma.tenant.upsert({ where: { id: YT }, update: {}, create: { id: YT, name: "Yield Co" } });

    // Settled fiat payment whose idle balance was swept + unwound (accrued 50).
    const unwoundId = await payment({
      tenantId: YT,
      intent: "recon_yield_unwound",
      status: "SETTLED",
      createdAt: IN_RANGE,
      recipientRef: "Yield Vendor",
      sourceAmount: "1000",
      targetCurrency: "PHP",
      targetAmount: "56700",
      legs: [
        { legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_yield_1" },
        { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-Y-1" },
      ],
      receiptJson: {
        id: "rcpt_yield_1",
        amounts: { source: { currency: "XLM", value: "1000.00" }, destination: { currency: "PHP", value: "56700.00" } },
        fx: { rate: "56.70" },
        yield: { accrued: "50", netYield: "50", status: "SWEPT_OUT" },
      },
    });
    await prisma.yieldPosition.create({
      data: {
        tenantId: YT, paymentId: unwoundId, status: "SWEPT_OUT",
        principal: "1000", accruedYield: "50", sweptInAmount: "999.5", sweptOutAmount: "1049.475",
      } as never,
    });

    // Settled payment whose unwind FAILED (served from buffer — still a drift).
    const failedId = await payment({
      tenantId: YT,
      intent: "recon_yield_failed",
      status: "SETTLED",
      createdAt: IN_RANGE,
      recipientRef: "Buffer Vendor",
      sourceAmount: "800",
      legs: [
        { legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_yield_2" },
        { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-Y-2" },
      ],
    });
    await prisma.yieldPosition.create({
      data: { tenantId: YT, paymentId: failedId, status: "FAILED", principal: "800" } as never,
    });

    // Non-settled payment with funds still parked in yield (not yet unwound).
    const parkedId = await payment({
      tenantId: YT,
      intent: "recon_yield_parked",
      status: "ONCHAIN_CONFIRMED",
      createdAt: IN_RANGE,
      recipientRef: "Parked Vendor",
      sourceAmount: "500",
      legs: [{ legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_yield_3" }],
    });
    await prisma.yieldPosition.create({
      data: { tenantId: YT, paymentId: parkedId, status: "SWEPT_IN", principal: "500" } as never,
    });

    stmt = await buildReconciliationStatement(YT, RANGE, NOW);
  });

  afterAll(async () => {
    await prisma.yieldPosition.deleteMany({ where: { tenantId: YT } });
    await prisma.receipt.deleteMany({ where: { payment: { tenantId: YT } } });
    await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: YT } } });
    await prisma.payment.deleteMany({ where: { tenantId: YT } });
    await prisma.tenant.deleteMany({ where: { id: YT } });
  });

  it("surfaces accrued yield on the settled row (from the stored receipt)", () => {
    const row = stmt.settled.find((r) => r.counterparty === "Yield Vendor")!;
    expect(row.yieldAccrued).toBe("50");
  });

  it("totals accrued yield by asset", () => {
    const xlm = stmt.totals.yieldBySymbol.find((t) => t.currency === "XLM");
    expect(xlm?.total).toBe("50");
  });

  it("flags a failed unwind on a settled payment as an exception (served from buffer)", () => {
    const drift = stmt.exceptions.find((e) => e.counterparty === "Buffer Vendor");
    expect(drift).toBeDefined();
    expect(drift!.reason).toContain("Yield unwind failed");
  });

  it("flags float still parked in a yield position on a non-settled payment", () => {
    const parked = stmt.exceptions.find((e) => e.counterparty === "Parked Vendor")!;
    expect(parked.reason).toContain("float still in yield position");
  });
});

describe("reconciliationToCsv", () => {
  it("renders a stable, sectioned CSV snapshot", () => {
    const fixture: ReconciliationStatement = {
      tenantId: "t1",
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" },
      generatedAt: "2026-07-31T23:59:59.999Z",
      settled: [
        {
          paymentId: "p1",
          date: "2026-07-10T09:00:00.000Z",
          counterparty: "Acme Vendor",
          corridor: "XLM -> PHP",
          sourceAsset: "XLM",
          sourceAmount: "100.00",
          targetCurrency: "PHP",
          targetAmount: "5670.00",
          fxRate: "56.70",
          fees: "0.00041 XLM; PHP 50.00; platform 0.00",
          slippage: "0.0000",
          txHash: "tx_settled_1",
          bankRef: "BANK-REF-1",
          receiptId: "rcpt_p1",
          yieldAccrued: "",
        },
      ],
      exceptions: [
        {
          paymentId: "p2",
          date: "2026-07-11T09:00:00.000Z",
          counterparty: "Bob",
          corridor: "XLM -> PHP",
          status: "PENDING",
          amount: "10 XLM",
          reason: "Awaiting on-chain confirmation",
        },
      ],
      totals: {
        settledCount: 1,
        exceptionCount: 1,
        sourceBySymbol: [{ currency: "XLM", total: "100" }],
        destinationByCurrency: [{ currency: "PHP", total: "5670" }],
        yieldBySymbol: [],
      },
    };
    expect(reconciliationToCsv(fixture)).toMatchInlineSnapshot(`
      "# Settled payments
      Date,Payment ID,Counterparty,Corridor,Source Asset,Source Amount,Target Currency,Target Amount,FX Rate,Fees,Slippage,On-chain Tx,Bank Ref,Receipt ID,Yield Accrued
      2026-07-10T09:00:00.000Z,p1,Acme Vendor,XLM -> PHP,XLM,100.00,PHP,5670.00,56.70,0.00041 XLM; PHP 50.00; platform 0.00,0.0000,tx_settled_1,BANK-REF-1,rcpt_p1,

      # Exceptions
      Date,Payment ID,Counterparty,Corridor,Status,Amount,Reason
      2026-07-11T09:00:00.000Z,p2,Bob,XLM -> PHP,PENDING,10 XLM,Awaiting on-chain confirmation

      # Totals
      Settled count,1
      Exception count,1
      Source total (XLM),100
      Settled total (PHP),5670"
    `);
  });
});

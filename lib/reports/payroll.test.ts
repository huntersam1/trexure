import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { buildPayrollRegister, payrollRegisterToCsv, type PayrollRegister } from "./payroll";
import type { DateRange } from "./scope";

const TENANT = "test_tenant_payroll_r3";
const OTHER = "test_tenant_payroll_r3_other";
const USER = "u_payroll_r3";
const NOW = new Date("2026-07-31T23:59:59.999Z");

const RANGE: DateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};
const IN_RANGE = new Date("2026-07-10T09:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-06-15T09:00:00.000Z");

type Leg = { legType: "ONCHAIN" | "FIAT"; status?: string; txHash?: string; bankRef?: string };

async function child(opts: {
  batchId: string;
  tenantId: string;
  intent: string;
  status: string;
  recipientRef: string;
  amount?: string;
  payoutMethod?: string;
  poolCommitment?: string;
  createdAt?: Date;
  legs?: Leg[];
  hasReceipt?: boolean;
}): Promise<string> {
  const p = await prisma.payment.create({
    data: {
      tenantId: opts.tenantId,
      batchId: opts.batchId,
      intentId: opts.intent,
      status: opts.status as never,
      createdAt: opts.createdAt ?? IN_RANGE,
      sourceAsset: "XLM",
      sourceAmount: opts.amount ?? "10",
      targetCurrency: opts.payoutMethod === "POOL_BANK" ? "PHP" : "XLM",
      corridorFrom: "XLM",
      corridorTo: opts.payoutMethod === "POOL_BANK" ? "PHP" : "XLM",
      recipientRef: opts.recipientRef,
      payoutMethod: (opts.payoutMethod as never) ?? "POOL_WALLET",
      poolCommitment: opts.poolCommitment ?? null,
      legs: opts.legs
        ? {
            create: opts.legs.map((l) => ({
              legType: l.legType as never,
              status: (l.status ?? "CONFIRMED") as never,
              txHash: l.txHash ?? null,
              bankRef: l.bankRef ?? null,
            })),
          }
        : undefined,
    } as never,
  });
  if (opts.hasReceipt) {
    await prisma.receipt.create({ data: { paymentId: p.id, json: { id: `rcpt_${opts.intent}` } as never } });
  }
  return p.id;
}

let batchId: string;
let otherBatchId: string;

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `Payroll ${id}` } });
  }
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: "payroll-admin", passwordHash: "x", role: "ADMIN" },
  });

  const b = await prisma.paymentBatch.create({
    data: { tenantId: TENANT, createdByUserId: USER, count: 4, totalSourceAmount: "60", createdAt: IN_RANGE },
  });
  batchId = b.id;

  // Alice — wallet, claimed
  await child({
    batchId, tenantId: TENANT, intent: "pr_alice", status: "SETTLED", recipientRef: "Alice",
    amount: "10", payoutMethod: "POOL_WALLET", poolCommitment: "0xalice",
    legs: [{ legType: "ONCHAIN", txHash: "tx_alice" }], hasReceipt: true,
  });
  // Bob — bank, claimed
  await child({
    batchId, tenantId: TENANT, intent: "pr_bob", status: "SETTLED", recipientRef: "Bob",
    amount: "20", payoutMethod: "POOL_BANK", poolCommitment: "0xbob",
    legs: [{ legType: "ONCHAIN", txHash: "tx_bob" }, { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-BOB" }],
    hasReceipt: true,
  });
  // Carol — wallet, unclaimed (sent, not yet claimed)
  await child({
    batchId, tenantId: TENANT, intent: "pr_carol", status: "PENDING", recipientRef: "Carol",
    amount: "15", payoutMethod: "POOL_WALLET", poolCommitment: "0xcarol",
  });
  // Dave — bank, failed (off-ramp failed, funds in custody)
  await child({
    batchId, tenantId: TENANT, intent: "pr_dave", status: "FAILED", recipientRef: "Dave",
    amount: "15", payoutMethod: "POOL_BANK", poolCommitment: "0xdave",
    legs: [{ legType: "ONCHAIN", txHash: "tx_dave" }],
  });

  // Out-of-range batch for the same tenant (excluded from a range query).
  const oldBatch = await prisma.paymentBatch.create({
    data: { tenantId: TENANT, createdByUserId: USER, count: 1, totalSourceAmount: "5", createdAt: OUT_OF_RANGE },
  });
  await child({ batchId: oldBatch.id, tenantId: TENANT, intent: "pr_june", status: "SETTLED", recipientRef: "June", createdAt: OUT_OF_RANGE });

  // Other tenant's batch — must never appear.
  const ob = await prisma.paymentBatch.create({
    data: { tenantId: OTHER, createdByUserId: USER, count: 1, totalSourceAmount: "99", createdAt: IN_RANGE },
  });
  otherBatchId = ob.id;
  await child({ batchId: ob.id, tenantId: OTHER, intent: "pr_other", status: "SETTLED", recipientRef: "Secret" });
});

afterAll(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.paymentBatch.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("buildPayrollRegister — single batch", () => {
  let reg: PayrollRegister;
  beforeAll(async () => {
    reg = await buildPayrollRegister(TENANT, { batchId }, NOW);
  });

  it("lists every disbursement with status, destination, and receipt", () => {
    expect(reg.batches).toHaveLength(1);
    const rows = reg.batches[0]!.rows;
    expect(rows).toHaveLength(4);
    const alice = rows.find((r) => r.receiver === "Alice")!;
    expect(alice.claimState).toBe("claimed");
    expect(alice.destination).toBe("on-chain wallet");
    expect(alice.withdrawTx).toBe("tx_alice");
    expect(alice.receiptId).toBe("rcpt_pr_alice");
    const bob = rows.find((r) => r.receiver === "Bob")!;
    expect(bob.payoutMethod).toBe("POOL_BANK");
    expect(bob.destination).toBe("BANK-BOB");
    const carol = rows.find((r) => r.receiver === "Carol")!;
    expect(carol.claimState).toBe("unclaimed");
    expect(carol.destination).toBe("");
    expect(carol.depositCommitment).toBe("0xcarol");
  });

  it("rolls up claimed / unclaimed / failed", () => {
    const g = reg.batches[0]!;
    expect(g.claimed).toBe(2);
    expect(g.unclaimed).toBe(1);
    expect(g.failed).toBe(1);
    expect(reg.totals.claimed).toBe(2);
    expect(reg.totals.unclaimed).toBe(1);
    expect(reg.totals.failed).toBe(1);
    expect(reg.totals.disbursementCount).toBe(4);
    const xlm = reg.totals.totalBySymbol.find((t) => t.currency === "XLM");
    expect(xlm?.total).toBe("60");
    const claimedXlm = reg.totals.claimedBySymbol.find((t) => t.currency === "XLM");
    expect(claimedXlm?.total).toBe("30"); // Alice 10 + Bob 20
  });

  it("flags a failed pool-bank claim as failed", () => {
    const dave = reg.batches[0]!.rows.find((r) => r.receiver === "Dave")!;
    expect(dave.claimState).toBe("failed");
  });
});

describe("buildPayrollRegister — date range across batches", () => {
  it("includes in-range batches and excludes out-of-range + other tenants", async () => {
    const reg = await buildPayrollRegister(TENANT, { range: RANGE }, NOW);
    const batchIds = reg.batches.map((b) => b.batchId);
    expect(batchIds).toContain(batchId);
    expect(reg.batches.every((b) => b.batchId !== otherBatchId)).toBe(true);
    // The out-of-range June batch is excluded.
    const receivers = reg.batches.flatMap((b) => b.rows.map((r) => r.receiver));
    expect(receivers).not.toContain("June");
    expect(receivers).not.toContain("Secret");
  });

  it("refuses another tenant's batch even when addressed by id", async () => {
    const reg = await buildPayrollRegister(TENANT, { batchId: otherBatchId }, NOW);
    expect(reg.batches).toHaveLength(0);
    expect(reg.totals.disbursementCount).toBe(0);
  });
});

describe("payrollRegisterToCsv", () => {
  it("renders a stable, sectioned CSV snapshot", () => {
    const fixture: PayrollRegister = {
      tenantId: "t1",
      scope: { batchId: "batch_1", range: null },
      generatedAt: "2026-07-31T23:59:59.999Z",
      batches: [
        {
          batchId: "batch_1",
          createdAt: "2026-07-10T09:00:00.000Z",
          createdByUsername: "admin",
          count: 2,
          totalSourceAmount: "30",
          claimed: 1,
          unclaimed: 1,
          failed: 0,
          rows: [
            {
              batchId: "batch_1", paymentId: "p1", date: "2026-07-10T09:00:00.000Z", receiver: "Alice",
              sourceAmount: "10", sourceAsset: "XLM", targetCurrency: "XLM", targetAmount: "",
              payoutMethod: "POOL_WALLET", status: "SETTLED", claimState: "claimed",
              destination: "on-chain wallet", depositCommitment: "0xalice", withdrawTx: "tx_alice", receiptId: "rcpt_p1",
            },
            {
              batchId: "batch_1", paymentId: "p2", date: "2026-07-10T09:05:00.000Z", receiver: "Carol",
              sourceAmount: "20", sourceAsset: "XLM", targetCurrency: "XLM", targetAmount: "",
              payoutMethod: "POOL_WALLET", status: "PENDING", claimState: "unclaimed",
              destination: "", depositCommitment: "0xcarol", withdrawTx: "", receiptId: "",
            },
          ],
        },
      ],
      totals: {
        batchCount: 1, disbursementCount: 2, claimed: 1, unclaimed: 1, failed: 0,
        totalBySymbol: [{ currency: "XLM", total: "30" }],
        claimedBySymbol: [{ currency: "XLM", total: "10" }],
      },
    };
    expect(payrollRegisterToCsv(fixture)).toMatchInlineSnapshot(`
      "# Disbursements
      Batch ID,Date,Receiver,Amount,Asset,Target,Method,Status,Claim State,Destination,Withdraw Tx,Deposit Commitment,Receipt ID
      batch_1,2026-07-10T09:00:00.000Z,Alice,10,XLM,,POOL_WALLET,SETTLED,claimed,on-chain wallet,tx_alice,0xalice,rcpt_p1
      batch_1,2026-07-10T09:05:00.000Z,Carol,20,XLM,,POOL_WALLET,PENDING,unclaimed,,,0xcarol,

      # Totals
      Batches,1
      Disbursements,2
      Claimed,1
      Unclaimed,1
      Failed,0
      Total (XLM),30
      Claimed total (XLM),10"
    `);
  });
});

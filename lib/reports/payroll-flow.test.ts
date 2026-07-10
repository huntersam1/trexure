import { describe, it, expect } from "vitest";

import type { PayrollRegister, PayrollRow, PayrollBatchGroup } from "./payroll";
import { buildPayrollFlow, destTypeOf, pendingAgeDays } from "./payroll-flow";

const GENERATED_AT = "2026-07-10T12:00:00.000Z";

function row(overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    batchId: "b1",
    paymentId: "p1",
    date: "2026-07-04T12:00:00.000Z",
    receiver: "Alice",
    sourceAmount: "10",
    sourceAsset: "XLM",
    targetCurrency: "XLM",
    targetAmount: "",
    payoutMethod: "POOL_WALLET",
    status: "SETTLED",
    claimState: "claimed",
    destination: "",
    depositCommitment: "0xc",
    withdrawTx: "txhash_abcdef123456",
    receiptId: "rcpt_1",
    ...overrides,
  };
}

function batch(rows: PayrollRow[], overrides: Partial<PayrollBatchGroup> = {}): PayrollBatchGroup {
  const claimed = rows.filter((r) => r.claimState === "claimed").length;
  const failed = rows.filter((r) => r.claimState === "failed").length;
  return {
    batchId: rows[0]?.batchId ?? "b1",
    createdAt: "2026-07-04T12:00:00.000Z",
    createdByUsername: "payroll-admin",
    count: rows.length,
    totalSourceAmount: "60",
    claimed,
    unclaimed: rows.length - claimed - failed,
    failed,
    rows,
    ...overrides,
  };
}

function register(batches: PayrollBatchGroup[]): PayrollRegister {
  const all = batches.flatMap((b) => b.rows);
  return {
    tenantId: "t1",
    scope: { batchId: null, range: null },
    generatedAt: GENERATED_AT,
    batches,
    totals: {
      batchCount: batches.length,
      disbursementCount: all.length,
      claimed: all.filter((r) => r.claimState === "claimed").length,
      unclaimed: all.filter((r) => r.claimState === "unclaimed").length,
      failed: all.filter((r) => r.claimState === "failed").length,
      totalBySymbol: [{ currency: "XLM", total: "60" }],
      claimedBySymbol: [{ currency: "XLM", total: "30" }],
    },
  };
}

describe("destTypeOf", () => {
  it("maps failed rows to FAILED regardless of method", () => {
    expect(destTypeOf({ claimState: "failed", payoutMethod: "POOL_BANK" })).toBe("FAILED");
    expect(destTypeOf({ claimState: "failed", payoutMethod: "" })).toBe("FAILED");
  });

  it("maps unclaimed rows to PENDING regardless of method", () => {
    expect(destTypeOf({ claimState: "unclaimed", payoutMethod: "POOL_WALLET" })).toBe("PENDING");
    expect(destTypeOf({ claimState: "unclaimed", payoutMethod: "" })).toBe("PENDING");
  });

  it("splits claimed rows by payout method, defaulting blank to WALLET", () => {
    expect(destTypeOf({ claimState: "claimed", payoutMethod: "POOL_BANK" })).toBe("BANK");
    expect(destTypeOf({ claimState: "claimed", payoutMethod: "POOL_WALLET" })).toBe("WALLET");
    expect(destTypeOf({ claimState: "claimed", payoutMethod: "" })).toBe("WALLET");
  });
});

describe("pendingAgeDays", () => {
  it("floors to whole days against generatedAt", () => {
    expect(pendingAgeDays("2026-07-04T12:00:00.000Z", GENERATED_AT)).toBe(6);
    expect(pendingAgeDays("2026-07-10T02:00:00.000Z", GENERATED_AT)).toBe(0);
  });

  it("clamps future dates to 0", () => {
    expect(pendingAgeDays("2026-07-11T00:00:00.000Z", GENERATED_AT)).toBe(0);
  });
});

describe("buildPayrollFlow", () => {
  it("groups rows by destination type in WALLET/BANK/PENDING/FAILED order and omits empty groups", () => {
    const reg = register([
      batch([
        row({ paymentId: "p_fail", receiver: "Dave", claimState: "failed", status: "FAILED" }),
        row({ paymentId: "p_wallet", receiver: "Alice" }),
        row({
          paymentId: "p_bank",
          receiver: "Bob",
          payoutMethod: "POOL_BANK",
          destination: "BANK-BOB",
          withdrawTx: "tx_bob",
        }),
      ]),
    ]);
    const flow = buildPayrollFlow(reg);

    expect(flow.batches).toHaveLength(1);
    expect(flow.batches[0]!.groups.map((g) => g.type)).toEqual(["WALLET", "BANK", "FAILED"]);
    expect(flow.batches[0]!.destTypes).toEqual(["WALLET", "BANK", "FAILED"]);
  });

  it("builds leaves with amount, detail, and payment-detail href", () => {
    const reg = register([
      batch([
        row({ paymentId: "p_wallet", receiver: "Alice", withdrawTx: "txhash_abcdef123456" }),
        row({
          paymentId: "p_bank",
          receiver: "Bob",
          sourceAmount: "20",
          payoutMethod: "POOL_BANK",
          destination: "BANK-BOB",
        }),
        row({ paymentId: "p_pending", receiver: "Carol", claimState: "unclaimed", status: "PENDING", withdrawTx: "" }),
      ]),
    ]);
    const [wallet, bankGroup, pending] = buildPayrollFlow(reg).batches[0]!.groups;

    expect(wallet!.leaves[0]).toEqual({
      paymentId: "p_wallet",
      batchId: "b1",
      receiver: "Alice",
      amount: "10 XLM",
      detail: "tx txhash_a…",
      href: "/pool/batches/b1/p_wallet",
    });
    expect(bankGroup!.leaves[0]!.detail).toBe("BANK-BOB");
    expect(bankGroup!.leaves[0]!.amount).toBe("20 XLM");
    expect(pending!.leaves[0]!.detail).toBe("unclaimed 6d");
  });

  it("falls back when refs are missing: short tx kept whole, blank bank ref labelled", () => {
    const reg = register([
      batch([
        row({ paymentId: "p_short", withdrawTx: "tx_alice" }),
        row({ paymentId: "p_nobank", payoutMethod: "POOL_BANK", destination: "" }),
        row({ paymentId: "p_notx", withdrawTx: "" }),
      ]),
    ]);
    const [wallet, bank] = buildPayrollFlow(reg).batches[0]!.groups;
    expect(wallet!.leaves.map((l) => l.detail)).toEqual(["tx tx_alice", "on-chain wallet"]);
    expect(bank!.leaves[0]!.detail).toBe("bank payout");
  });

  it("subtotals each group by asset and carries batch/root metadata", () => {
    const reg = register([
      batch([
        row({ paymentId: "p1", sourceAmount: "10" }),
        row({ paymentId: "p2", receiver: "Erin", sourceAmount: "5.5" }),
        row({ paymentId: "p3", receiver: "Frank", claimState: "unclaimed", status: "PENDING" }),
      ]),
    ]);
    const flow = buildPayrollFlow(reg);
    const b = flow.batches[0]!;

    expect(flow.disbursementCount).toBe(3);
    expect(flow.totals).toEqual([{ currency: "XLM", total: "60" }]);
    expect(b.groups[0]!.totals).toEqual([{ currency: "XLM", total: "15.5" }]);
    expect(b.groups[0]!.count).toBe(2);
    expect({ claimed: b.claimed, unclaimed: b.unclaimed, failed: b.failed }).toEqual({
      claimed: 2,
      unclaimed: 1,
      failed: 0,
    });
    expect(b.createdByUsername).toBe("payroll-admin");
  });

  it("returns an empty batch list for an empty register", () => {
    expect(buildPayrollFlow(register([])).batches).toEqual([]);
  });
});

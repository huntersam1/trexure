import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const payments = new Map<string, any>();
  const legs: any[] = [];
  const receipts = new Map<string, any>();
  const anchorConfigs: any[] = [];
  const yieldPositions = new Map<string, any>();
  const prisma = {
    payment: {
      findUnique: async ({ where, include }: any) => {
        const p = payments.get(where.id);
        if (!p) return null;
        const out: any = { ...p };
        if (include?.legs) out.legs = legs.filter((l) => l.paymentId === p.id);
        if (include?.receipt) out.receipt = receipts.get(p.id) ?? null;
        if (include?.yieldPosition) out.yieldPosition = yieldPositions.get(p.id) ?? null;
        return out;
      },
    },
    anchorConfig: {
      findFirst: async ({ where }: any) =>
        anchorConfigs.find((a) => a.tenantId === where.tenantId) ?? null,
    },
    receipt: {
      upsert: async ({ where, create, update }: any) => {
        const existing = receipts.get(where.paymentId);
        if (existing) { Object.assign(existing, update); return existing; }
        const created = { ...create };
        receipts.set(where.paymentId, created);
        return created;
      },
    },
  };
  return { store: { payments, legs, receipts, anchorConfigs, yieldPositions }, prisma };
});

vi.mock("../db", () => ({ prisma: h.prisma, forTenant: () => h.prisma }));

import { Prisma } from "../generated/prisma/client";
import { buildReceipt } from "./receipt";

function seedSettleable() {
  h.store.payments.clear();
  h.store.legs.length = 0;
  h.store.receipts.clear();
  h.store.anchorConfigs.length = 0;
  h.store.yieldPositions.clear();
  h.store.payments.set("p1", {
    id: "p1", tenantId: "t1", intentId: "intent_1",
    sourceAsset: "USDC", sourceAmount: "2500.00",
    targetCurrency: "PHP", targetAmount: "141750.00",
    corridorFrom: "USD", corridorTo: "PHP",
    shielded: true, proofHash: "proof_abc", status: "ONCHAIN_CONFIRMED",
  });
  h.store.legs.push({
    paymentId: "p1", legType: "ONCHAIN", status: "CONFIRMED",
    txHash: "tx_deadbeef", ledger: 123456, contractId: "C_ZK",
  });
  h.store.legs.push({
    paymentId: "p1", legType: "FIAT", status: "RECEIVED",
    provider: "mock-anchor", providerRef: "mock_payout_1", bankRef: "PH-BANK-1",
    amount: "141750.00", currency: "PHP", receivedAt: new Date("2026-07-15T08:21:04Z"),
  });
}

describe("buildReceipt", () => {
  beforeEach(seedSettleable);

  it("produces the exact §6.4 shape with decimal STRING amounts", async () => {
    const r = await buildReceipt("p1");

    // Top-level key set matches §6.4 exactly.
    expect(Object.keys(r).sort()).toEqual(
      ["amounts","corridor","created","fees","fiat","fx","id","onchain","paymentId","privacy","slippage","status"].sort(),
    );
    expect(r.id).toMatch(/^rcpt_/);
    expect(r.paymentId).toBe("p1");
    expect(r.status).toBe("settled");
    expect(r.corridor).toEqual({ from: "USD", to: "PHP" });

    // Money is strings, never JS number.
    expect(typeof r.amounts.source.value).toBe("string");
    expect(typeof r.amounts.destination.value).toBe("string");
    expect(typeof r.fx.rate).toBe("string");
    expect(typeof r.slippage).toBe("string");
    expect(r.amounts.source).toEqual({ currency: "USD", value: "2500.00" });
    expect(r.amounts.destination).toEqual({ currency: "PHP", value: "141750.00" });
    expect(r.fx.rate).toBe("56.70"); // 141750 / 2500

    expect(r.fees).toEqual({ network: expect.stringMatching(/XLM$/), anchor: expect.stringMatching(/^PHP /), platform: "0.00" });
    expect(r.onchain).toEqual({ txHash: "tx_deadbeef", ledger: 123456, proofHash: "proof_abc", asset: "USDC" });
    expect(typeof r.onchain.ledger).toBe("number");
    expect(r.fiat).toEqual({ provider: "mock-anchor", reference: "mock_payout_1", bankRef: "PH-BANK-1" });
    expect(r.privacy).toEqual({ shielded: true, viewKeyDisclosed: false });
  });

  it("persists the receipt and is idempotent (upsert, one row)", async () => {
    await buildReceipt("p1");
    await buildReceipt("p1");
    expect(h.store.receipts.size).toBe(1);
    expect(h.store.receipts.get("p1").json.status).toBe("settled");
  });

  it("has no yield block when the payment has no yield position", async () => {
    const r = await buildReceipt("p1");
    expect(r.yield).toBeUndefined();
    expect(Object.keys(r)).not.toContain("yield");
  });

  it("adds a yield block derived from the position (#161 P4)", async () => {
    const D = Prisma.Decimal;
    h.store.yieldPositions.set("p1", {
      paymentId: "p1", status: "SWEPT_OUT", yieldAsset: "YLDS",
      principal: new D("800"), accruedYield: new D("50"),
      sweptInAmount: new D("799.6"), sweptOutAmount: new D("849.575"),
      feeBps: new D("25"), sweepInTxHash: "in_tx", sweepOutTxHash: "out_tx",
    });

    const r = await buildReceipt("p1");
    expect(r.yield).toEqual({
      asset: "YLDS",
      status: "SWEPT_OUT",
      principal: "800.00",
      accrued: "50.00000000",
      platformFee: "0.12500000", // 50 * 25bps
      netYield: "49.87500000",
      feeBps: "25",
      slippage: "0.82500000", // (800-799.6) + (850-849.575)
      sweepInTx: "in_tx",
      sweepOutTx: "out_tx",
    });
  });
});

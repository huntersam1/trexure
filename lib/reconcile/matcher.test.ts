import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const payments = new Map<string, any>();
  const legs: any[] = [];
  const receipts = new Map<string, any>();
  const anchorConfigs: any[] = [];
  const prisma = {
    payment: {
      findUnique: async ({ where, include }: any) => {
        const p = payments.get(where.id);
        if (!p) return null;
        const out: any = { ...p };
        if (include?.legs) out.legs = legs.filter((l) => l.paymentId === p.id);
        if (include?.receipt) out.receipt = receipts.get(p.id) ?? null;
        return out;
      },
      update: async ({ where, data }: any) => {
        const p = payments.get(where.id);
        Object.assign(p, data);
        return p;
      },
      updateMany: async ({ where, data }: any) => {
        const p = payments.get(where.id);
        if (!p) return { count: 0 };
        if (where.status?.notIn?.includes(p.status)) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    anchorConfig: { findFirst: async ({ where }: any) => anchorConfigs.find((a) => a.tenantId === where.tenantId) ?? null },
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
  return { store: { payments, legs, receipts, anchorConfigs }, prisma };
});

vi.mock("../db", () => ({ prisma: h.prisma, forTenant: () => h.prisma }));

import { tryReconcile } from "./matcher";

function reset() {
  h.store.payments.clear();
  h.store.legs.length = 0;
  h.store.receipts.clear();
  h.store.anchorConfigs.length = 0;
}

function seedPayment(status = "PENDING") {
  h.store.payments.set("p1", {
    id: "p1", tenantId: "t1", intentId: "intent_1",
    sourceAsset: "USDC", sourceAmount: "2500.00",
    targetCurrency: "PHP", targetAmount: "141750.00",
    corridorFrom: "USD", corridorTo: "PHP",
    shielded: true, proofHash: "proof_abc", status,
  });
}
const onchainLeg = () => ({ paymentId: "p1", legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_1", ledger: 123456, contractId: "C_ZK" });
const fiatLeg = (amount = "141750.00", currency = "PHP") => ({
  paymentId: "p1", legType: "FIAT", status: "RECEIVED",
  provider: "mock-anchor", providerRef: "mp_1", bankRef: "PH-1",
  amount, currency, receivedAt: new Date("2026-07-15T08:21:04Z"),
});

describe("tryReconcile", () => {
  beforeEach(reset);

  it("chain-first then fiat converges to SETTLED", async () => {
    seedPayment("ONCHAIN_CONFIRMED");
    h.store.legs.push(onchainLeg());
    expect(await tryReconcile("p1")).toBe("WAITING"); // fiat absent
    h.store.legs.push(fiatLeg());
    expect(await tryReconcile("p1")).toBe("SETTLED");
    expect(h.store.payments.get("p1").status).toBe("SETTLED");
    expect(h.store.receipts.size).toBe(1);
  });

  it("fiat-first then chain converges to SETTLED", async () => {
    seedPayment("PENDING");
    h.store.legs.push(fiatLeg());
    expect(await tryReconcile("p1")).toBe("WAITING"); // onchain absent
    h.store.legs.push(onchainLeg());
    expect(await tryReconcile("p1")).toBe("SETTLED");
    expect(h.store.payments.get("p1").status).toBe("SETTLED");
  });

  it("double reconcile after SETTLED is a no-op (one receipt)", async () => {
    seedPayment("ONCHAIN_CONFIRMED");
    h.store.legs.push(onchainLeg(), fiatLeg());
    expect(await tryReconcile("p1")).toBe("SETTLED");
    expect(await tryReconcile("p1")).toBe("SETTLED");
    expect(h.store.receipts.size).toBe(1);
  });

  it("intent mismatch (fiat leg landed on a different payment) → WAITING, no settle", async () => {
    seedPayment("ONCHAIN_CONFIRMED");
    h.store.legs.push(onchainLeg()); // fiat for intent_2 attached elsewhere, not to p1
    expect(await tryReconcile("p1")).toBe("WAITING");
    expect(h.store.payments.get("p1").status).toBe("ONCHAIN_CONFIRMED");
    expect(h.store.receipts.size).toBe(0);
  });

  it("amount outside FX tolerance → WAITING (never settles on amount alone)", async () => {
    seedPayment("ONCHAIN_CONFIRMED");
    h.store.legs.push(onchainLeg(), fiatLeg("100000.00")); // ~29% below quoted
    expect(await tryReconcile("p1")).toBe("WAITING");
    expect(h.store.receipts.size).toBe(0);
  });

  it("a failed leg fails the payment", async () => {
    seedPayment("PENDING");
    h.store.legs.push(onchainLeg(), { ...fiatLeg(), status: "FAILED" });
    expect(await tryReconcile("p1")).toBe("FAILED");
    expect(h.store.payments.get("p1").status).toBe("FAILED");
  });
});

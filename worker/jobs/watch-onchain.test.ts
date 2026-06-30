import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const payments = new Map<string, any>();
  const legs: any[] = [];
  const prisma = {
    payment: {
      findUnique: async ({ where, include }: any) => {
        const p = payments.get(where.id);
        if (!p) return null;
        const out: any = { ...p };
        if (include?.legs) out.legs = legs.filter((l) => l.paymentId === p.id);
        return out;
      },
      update: async ({ where, data }: any) => { Object.assign(payments.get(where.id), data); return payments.get(where.id); },
    },
    paymentLeg: {
      upsert: async ({ where, create, update }: any) => {
        const { paymentId, legType } = where.paymentId_legType;
        const ex = legs.find((l) => l.paymentId === paymentId && l.legType === legType);
        if (ex) { Object.assign(ex, update); return ex; }
        const created = { paymentId, legType, ...create };
        legs.push(created);
        return created;
      },
    },
  };
  const getContractEvents = vi.fn();
  const reconcileAdd = vi.fn(async () => {});
  return { store: { payments, legs }, prisma, getContractEvents, reconcileAdd };
});

vi.mock("../../lib/db", () => ({ prisma: h.prisma }));
vi.mock("../../lib/env", () => ({ env: { ZK_CONTRACT_ID: "C_ENV" } }));
vi.mock("../../lib/stellar/client", () => ({ getContractEvents: h.getContractEvents }));
vi.mock("../../lib/queue", () => ({
  QUEUE: { WATCH_ONCHAIN: "watch-onchain", RECONCILE: "reconcile" },
  reconcileQueue: { add: h.reconcileAdd },
}));

import { processWatchOnchain, watchOnchainBackoff, MAX_WATCH_ATTEMPTS, MAX_BACKOFF_MS } from "./watch-onchain";

function reset() {
  h.store.payments.clear();
  h.store.legs.length = 0;
  h.getContractEvents.mockReset();
  h.reconcileAdd.mockReset();
  h.store.payments.set("p1", { id: "p1", intentId: "intent_1", status: "PENDING", proofHash: null });
}
const job = (attemptsMade = 0) => ({ data: { paymentId: "p1" }, attemptsMade }) as any;

describe("processWatchOnchain", () => {
  beforeEach(reset);

  it("on event match: upserts CONFIRMED onchain leg, confirms payment, enqueues reconcile", async () => {
    h.getContractEvents.mockResolvedValue([{ txHash: "tx_9", ledger: 777, proofHash: "ph_9" }]);
    await processWatchOnchain(job(0));

    const leg = h.store.legs.find((l) => l.legType === "ONCHAIN");
    expect(leg).toMatchObject({ status: "CONFIRMED", txHash: "tx_9", ledger: 777 });
    expect(h.store.payments.get("p1")).toMatchObject({ status: "ONCHAIN_CONFIRMED", proofHash: "ph_9" });
    expect(h.reconcileAdd).toHaveBeenCalledWith("reconcile", { paymentId: "p1" });
  });

  it("polls the intentId as the topic", async () => {
    h.getContractEvents.mockResolvedValue([{ txHash: "t", ledger: 1, proofHash: "p" }]);
    await processWatchOnchain(job(0));
    expect(h.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ topic: "intent_1" }));
  });

  it("no event + attempts remaining: throws to trigger backoff", async () => {
    h.getContractEvents.mockResolvedValue([]);
    await expect(processWatchOnchain(job(0))).rejects.toThrow();
    expect(h.store.payments.get("p1").status).toBe("PENDING");
  });

  it("no event + attempts exhausted: marks Payment FAILED, no throw", async () => {
    h.getContractEvents.mockResolvedValue([]);
    await processWatchOnchain(job(MAX_WATCH_ATTEMPTS - 1));
    expect(h.store.payments.get("p1").status).toBe("FAILED");
  });

  it("skips terminal payments", async () => {
    h.store.payments.get("p1").status = "SETTLED";
    await processWatchOnchain(job(0));
    expect(h.getContractEvents).not.toHaveBeenCalled();
  });

  it("backoff is exponential and capped", () => {
    expect(watchOnchainBackoff(0)).toBe(1000);
    expect(watchOnchainBackoff(3)).toBe(8000);
    expect(watchOnchainBackoff(20)).toBe(MAX_BACKOFF_MS);
  });
});

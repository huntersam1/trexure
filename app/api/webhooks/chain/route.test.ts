import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { ANCHOR_CALLBACK_TOKEN: "test-callback-token", ANCHOR_PROVIDER: "mock-anchor" },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

const db = vi.hoisted(() => ({
  webhookEvent: { create: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  payment: { findUnique: vi.fn(), update: vi.fn() },
  paymentLeg: { upsert: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

const queue = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/lib/queue", () => ({
  QUEUE: { WATCH_ONCHAIN: "watch-onchain", RECONCILE: "reconcile" },
  reconcileQueue: queue,
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSec: 0 }),
}));
vi.mock("@/lib/log", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { POST } from "@/app/api/webhooks/chain/route";
import { signHmac } from "@/lib/webhooks/verify";

const evt = {
  id: "chain_evt_1",
  intentId: "intent_123",
  txHash: "abc123",
  ledger: 123456,
  contractId: "C_CONTRACT",
  proofHash: "deadbeef",
};

function reqFor(body: object, token: string) {
  const raw = JSON.stringify(body);
  return new Request("http://localhost:3000/api/webhooks/chain", {
    method: "POST",
    headers: { "content-type": "application/json", "x-callback-token": token },
    body: raw,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.payment.findUnique.mockResolvedValue({ id: "pay_1", intentId: "intent_123", proofHash: null });
  db.webhookEvent.create.mockResolvedValue({});
  db.webhookEvent.update.mockResolvedValue({});
  db.paymentLeg.upsert.mockResolvedValue({});
  db.payment.update.mockResolvedValue({});
});

describe("POST /api/webhooks/chain", () => {
  it("writes a CONFIRMED ONCHAIN leg and enqueues reconcile", async () => {
    const raw = JSON.stringify(evt);
    const res = await POST(reqFor(evt, signHmac(raw, mockEnv.ANCHOR_CALLBACK_TOKEN)));
    expect(res.status).toBe(200);
    const arg = db.paymentLeg.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ paymentId_legType: { paymentId: "pay_1", legType: "ONCHAIN" } });
    expect(arg.create).toMatchObject({ legType: "ONCHAIN", status: "CONFIRMED", txHash: "abc123", ledger: 123456 });
    expect(queue.add).toHaveBeenCalledWith("reconcile", { paymentId: "pay_1" }, expect.any(Object));
  });

  it("rejects an invalid HMAC with 401 and writes no leg", async () => {
    const res = await POST(reqFor(evt, "bad"));
    expect(res.status).toBe(401);
    expect(db.paymentLeg.upsert).not.toHaveBeenCalled();
  });
});

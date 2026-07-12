import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    ANCHOR_CALLBACK_TOKEN: "test-callback-token",
    ANCHOR_PROVIDER: "mock-anchor",
    ENABLE_MOCK_ANCHOR: true,
    APP_URL: "http://localhost:3000",
  },
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

const { loadAnchorWebhookSecret } = vi.hoisted(() => ({ loadAnchorWebhookSecret: vi.fn() }));
vi.mock("@/lib/anchor/secret", () => ({ loadAnchorWebhookSecret }));

vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSec: 0 }),
}));
vi.mock("@/lib/log", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/webhooks/fiat/route";
import { signHmac } from "@/lib/webhooks/verify";

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_mock_1",
    event: "payment.completed",
    intentId: "intent_123",
    providerRef: "mock_payout_1",
    bankRef: "PH-BANK-1",
    amount: "141750.00",
    currency: "PHP",
    fxRate: "56.70",
    anchorFee: "50.00",
    createdAt: "2026-07-15T08:21:03Z",
    ...overrides,
  };
}

function reqFor(body: object, token?: string) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["x-callback-token"] = token;
  return new Request("http://localhost:3000/api/webhooks/fiat", {
    method: "POST",
    headers,
    body: raw,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no per-tenant secret configured → falls back to the global token.
  loadAnchorWebhookSecret.mockResolvedValue(null);
  db.payment.findUnique.mockResolvedValue({ id: "pay_1", tenantId: "t1", intentId: "intent_123" });
  db.webhookEvent.create.mockResolvedValue({});
  db.webhookEvent.upsert.mockResolvedValue({});
  db.webhookEvent.update.mockResolvedValue({});
  db.paymentLeg.upsert.mockResolvedValue({});
  db.payment.update.mockResolvedValue({});
});

describe("POST /api/webhooks/fiat", () => {
  it("accepts a valid HMAC and creates a RECEIVED FIAT leg + enqueues reconcile", async () => {
    const evt = buildEvent();
    const raw = JSON.stringify(evt);
    const res = await POST(reqFor(evt, signHmac(raw, mockEnv.ANCHOR_CALLBACK_TOKEN)));
    expect(res.status).toBe(200);
    expect(db.paymentLeg.upsert).toHaveBeenCalledTimes(1);
    const arg = db.paymentLeg.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ paymentId_legType: { paymentId: "pay_1", legType: "FIAT" } });
    expect(arg.create.status).toBe("RECEIVED");
    expect(queue.add).toHaveBeenCalledWith("reconcile", { paymentId: "pay_1" }, expect.any(Object));
  });

  it("rejects an invalid HMAC with 401 and creates NO leg", async () => {
    const evt = buildEvent();
    const res = await POST(reqFor(evt, "deadbeef"));
    expect(res.status).toBe(401);
    expect(db.paymentLeg.upsert).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    // unverified event is logged for admin review
    expect(db.webhookEvent.upsert).toHaveBeenCalledTimes(1);
    expect(db.webhookEvent.upsert.mock.calls[0]![0].create.verified).toBe(false);
  });

  it("treats a duplicate externalId as an idempotent no-op (200, no leg)", async () => {
    db.webhookEvent.create.mockRejectedValueOnce({ code: "P2002" });
    const evt = buildEvent();
    const raw = JSON.stringify(evt);
    const res = await POST(reqFor(evt, signHmac(raw, mockEnv.ANCHOR_CALLBACK_TOKEN)));
    expect(res.status).toBe(200);
    expect(db.paymentLeg.upsert).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("verifies against the tenant's per-tenant secret when configured (#143 H1)", async () => {
    loadAnchorWebhookSecret.mockResolvedValue("tenant-specific-secret");
    const evt = buildEvent();
    const raw = JSON.stringify(evt);
    // Signed with the tenant's own secret → accepted.
    const res = await POST(reqFor(evt, signHmac(raw, "tenant-specific-secret")));
    expect(res.status).toBe(200);
    expect(loadAnchorWebhookSecret).toHaveBeenCalledWith("t1", mockEnv.ANCHOR_PROVIDER);
    expect(db.paymentLeg.upsert).toHaveBeenCalledTimes(1);
  });

  it("rejects the global token once the tenant has set its own secret (#143 H1)", async () => {
    loadAnchorWebhookSecret.mockResolvedValue("tenant-specific-secret");
    const evt = buildEvent();
    const raw = JSON.stringify(evt);
    // The old global token no longer authenticates this tenant's events.
    const res = await POST(reqFor(evt, signHmac(raw, mockEnv.ANCHOR_CALLBACK_TOKEN)));
    expect(res.status).toBe(401);
    expect(db.paymentLeg.upsert).not.toHaveBeenCalled();
  });

  it("drives the payment to FAILED on payment.failed", async () => {
    const evt = buildEvent({ id: "evt_mock_2", event: "payment.failed" });
    const raw = JSON.stringify(evt);
    const res = await POST(reqFor(evt, signHmac(raw, mockEnv.ANCHOR_CALLBACK_TOKEN)));
    expect(res.status).toBe(200);
    expect(db.paymentLeg.upsert.mock.calls[0]![0].create.status).toBe("FAILED");
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: "pay_1" },
      data: { status: "FAILED" },
    });
  });
});

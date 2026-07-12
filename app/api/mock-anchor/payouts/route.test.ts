import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppError } from "@/lib/http/problem";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { ENABLE_MOCK_ANCHOR: true, ANCHOR_PROVIDER: "mock-anchor" },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession }));

const { webhookFindMany, paymentFindMany } = vi.hoisted(() => ({
  webhookFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { webhookEvent: { findMany: webhookFindMany } },
  forTenant: () => ({ payment: { findMany: paymentFindMany } }),
}));

import { GET } from "@/app/api/mock-anchor/payouts/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.ENABLE_MOCK_ANCHOR = true;
  requireSession.mockResolvedValue({ id: "u1", role: "ADMIN", tenantId: "t1" });
});

describe("GET /api/mock-anchor/payouts", () => {
  it("returns 404 when the flag is off (no session probe)", async () => {
    mockEnv.ENABLE_MOCK_ANCHOR = false;
    const res = await GET();
    expect(res.status).toBe(404);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    requireSession.mockRejectedValue(new AppError(401, "Unauthorized"));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("only returns payout events whose intentId belongs to the caller's tenant (#143)", async () => {
    webhookFindMany.mockResolvedValue([
      { externalId: "own", verified: true, processedAt: null, createdAt: new Date(), payload: { intentId: "i_own" } },
      { externalId: "other", verified: true, processedAt: null, createdAt: new Date(), payload: { intentId: "i_other" } },
      { externalId: "noIntent", verified: false, processedAt: null, createdAt: new Date(), payload: {} },
    ]);
    // forTenant("t1") only resolves the tenant's own payment.
    paymentFindMany.mockResolvedValue([{ intentId: "i_own" }]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.payouts.map((p: { externalId: string }) => p.externalId);
    expect(ids).toEqual(["own"]);
    // The tenant filter was applied over the events' intent ids.
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { intentId: { in: ["i_own", "i_other"] } } }),
    );
  });
});

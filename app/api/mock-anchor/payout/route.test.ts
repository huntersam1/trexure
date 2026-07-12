import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { ENABLE_MOCK_ANCHOR: true, ANCHOR_PROVIDER: "mock-anchor" },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ id: "u1", username: "admin", role: "ADMIN", tenantId: "t1" }),
}));

const assertCsrf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf }));

const trigger = vi.hoisted(() => vi.fn());
vi.mock("@/lib/anchor/mock", () => ({ triggerMockPayout: trigger }));

import { POST } from "@/app/api/mock-anchor/payout/route";
import { AppError } from "@/lib/http/problem";

function reqFor(body: object) {
  return new Request("http://localhost:3000/api/mock-anchor/payout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { intentId: "intent_123", amount: "141750.00", currency: "PHP", recipientRef: "rcpt_1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.ENABLE_MOCK_ANCHOR = true;
  trigger.mockResolvedValue({ providerRef: "mock_payout_1", bankRef: "PH-BANK-1", status: "completed" });
});

describe("POST /api/mock-anchor/payout", () => {
  it("returns 404 when ENABLE_MOCK_ANCHOR is false (before any session check)", async () => {
    mockEnv.ENABLE_MOCK_ANCHOR = false;
    const res = await POST(reqFor(validBody));
    expect(res.status).toBe(404);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("triggers a payout and returns providerRef/bankRef/status", async () => {
    const res = await POST(reqFor(validBody));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ providerRef: "mock_payout_1", bankRef: "PH-BANK-1", status: "completed" });
    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ intentId: "intent_123" }));
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST(reqFor({ intentId: "i", oops: true }));
    expect(res.status).toBe(400);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("returns 403 and does not trigger a payout when CSRF fails (#143)", async () => {
    assertCsrf.mockImplementationOnce(() => {
      throw new AppError(403, "Forbidden", "Invalid CSRF token");
    });
    const res = await POST(reqFor(validBody));
    expect(res.status).toBe(403);
    expect(trigger).not.toHaveBeenCalled();
  });
});

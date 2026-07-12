import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock fns (vi.mock factories run before top-level consts).
const { requireSession, assertCsrf, createPoolBatch, envMock } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assertCsrf: vi.fn(),
  createPoolBatch: vi.fn(),
  envMock: { ENABLE_POOL_RAIL: true },
}));

vi.mock("@/lib/auth/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("@/lib/pool/batch", () => ({ createPoolBatch }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { POST } from "@/app/api/pool/batch/route";
import { AppError } from "@/lib/http/problem";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/pool/batch", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  receivers: [
    { amount: 10, ref: "Alice", email: "alice@example.com" },
    { amount: 5, ref: "Bob" },
  ],
};

describe("POST /api/pool/batch", () => {
  beforeEach(() => {
    envMock.ENABLE_POOL_RAIL = true;
    requireSession.mockReset().mockResolvedValue({ id: "u1", tenantId: "t1", role: "MEMBER" });
    assertCsrf.mockReset();
    createPoolBatch.mockReset().mockResolvedValue({
      batchId: "batch_1",
      requested: 2,
      count: 2,
      totalSourceAmount: "15",
      poolContractId: "CPOOL",
      claimUrl: "http://localhost/claim",
      results: [
        { ok: true, ref: "Alice", amount: "10", note: "trexure-note-v1-a", paymentId: "p1" },
        { ok: true, ref: "Bob", amount: "5", note: "trexure-note-v1-b", paymentId: "p2" },
      ],
    });
  });

  it("creates the batch and returns N notes (201)", async () => {
    const res = await POST(jsonReq(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.batchId).toBe("batch_1");
    expect(body.count).toBe(2);
    expect(body.results).toHaveLength(2);
    expect(assertCsrf).toHaveBeenCalled();
    // tenantId + userId from the session; amounts normalized to decimal strings (#143 H2).
    expect(createPoolBatch).toHaveBeenCalledWith("t1", "u1", {
      receivers: [
        { amount: "10", ref: "Alice", email: "alice@example.com" },
        { amount: "5", ref: "Bob" },
      ],
    });
  });

  it("404s when the rail is disabled and never touches the pool", async () => {
    envMock.ENABLE_POOL_RAIL = false;
    const res = await POST(jsonReq(validBody));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(createPoolBatch).not.toHaveBeenCalled();
  });

  it("returns 403 when CSRF fails", async () => {
    assertCsrf.mockImplementation(() => {
      throw new AppError(403, "CSRF check failed");
    });
    const res = await POST(jsonReq(validBody));
    expect(res.status).toBe(403);
    expect(createPoolBatch).not.toHaveBeenCalled();
  });

  it("rejects an empty receiver list with 422", async () => {
    const res = await POST(jsonReq({ receivers: [] }));
    expect(res.status).toBe(422);
    expect(createPoolBatch).not.toHaveBeenCalled();
  });

  it("rejects a row with a bad amount / missing label with 422", async () => {
    const res = await POST(jsonReq({ receivers: [{ amount: -5, ref: "" }] }));
    expect(res.status).toBe(422);
    expect(createPoolBatch).not.toHaveBeenCalled();
  });
});

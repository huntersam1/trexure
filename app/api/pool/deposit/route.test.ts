import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock fns (vi.mock factories run before top-level consts).
const { requireSession, assertCsrf, createPoolDeposit, enforceRateLimit, envMock } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assertCsrf: vi.fn(),
  createPoolDeposit: vi.fn(),
  enforceRateLimit: vi.fn(),
  envMock: { ENABLE_POOL_RAIL: true },
}));

vi.mock("@/lib/auth/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("@/lib/pool/service", () => ({ createPoolDeposit }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { POST } from "@/app/api/pool/deposit/route";
import { AppError } from "@/lib/http/problem";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/pool/deposit", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pool/deposit", () => {
  beforeEach(() => {
    envMock.ENABLE_POOL_RAIL = true;
    requireSession.mockReset().mockResolvedValue({ id: "u1", tenantId: "t1", role: "MEMBER" });
    assertCsrf.mockReset();
    enforceRateLimit.mockReset().mockResolvedValue(null); // allowed by default
    createPoolDeposit.mockReset().mockResolvedValue({
      note: "trexure-note-v1-abc",
      txHash: "deadbeef",
      ledger: 42,
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/deadbeef",
    });
  });

  it("deposits and returns the note + tx once (201)", async () => {
    const res = await POST(jsonReq({ amount: 10 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.note).toBe("trexure-note-v1-abc");
    expect(body.txHash).toBe("deadbeef");
    expect(assertCsrf).toHaveBeenCalled();
    expect(createPoolDeposit).toHaveBeenCalledWith({ amount: "10" }); // normalized to a decimal string (#143 H2)
    expect(enforceRateLimit).toHaveBeenCalledWith("pool-deposit:t1", expect.objectContaining({ limit: 15 }));
  });

  it("returns the rate-limit 429 and never touches the pool when throttled (#143)", async () => {
    enforceRateLimit.mockResolvedValue(
      new Response("{}", { status: 429, headers: { "retry-after": "42" } }),
    );
    const res = await POST(jsonReq({ amount: 10 }));
    expect(res.status).toBe(429);
    expect(createPoolDeposit).not.toHaveBeenCalled();
  });

  it("404s when the rail is disabled and never touches the pool", async () => {
    envMock.ENABLE_POOL_RAIL = false;
    const res = await POST(jsonReq({ amount: 10 }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(createPoolDeposit).not.toHaveBeenCalled();
  });

  it("returns 403 when CSRF fails", async () => {
    assertCsrf.mockImplementation(() => {
      throw new AppError(403, "CSRF check failed");
    });
    const res = await POST(jsonReq({ amount: 10 }));
    expect(res.status).toBe(403);
    expect(createPoolDeposit).not.toHaveBeenCalled();
  });

  it("rejects an invalid amount with 422", async () => {
    const res = await POST(jsonReq({ amount: -5 }));
    expect(res.status).toBe(422);
    expect(createPoolDeposit).not.toHaveBeenCalled();
  });
});

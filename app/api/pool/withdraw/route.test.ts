import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireSession, assertCsrf, createPoolWithdraw, envMock } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assertCsrf: vi.fn(),
  createPoolWithdraw: vi.fn(),
  envMock: { ENABLE_POOL_RAIL: true },
}));

vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("@/lib/pool/service", () => ({ createPoolWithdraw }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { POST } from "@/app/api/pool/withdraw/route";
import { AppError } from "@/lib/http/problem";

const GOOD_RECIPIENT = "GA6N25U5KNP667K6B2HTZH3BQG6AKYNNYS3BWS4FHZ7IV2QWIBI3P6CQ";
const NOTE = "trexure-note-v1-" + "a".repeat(192);

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/pool/withdraw", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pool/withdraw", () => {
  beforeEach(() => {
    envMock.ENABLE_POOL_RAIL = true;
    requireSession.mockReset().mockResolvedValue({ id: "u1", tenantId: "t1", role: "MEMBER" });
    assertCsrf.mockReset();
    createPoolWithdraw.mockReset().mockResolvedValue({
      txHash: "beefcafe",
      ledger: 7,
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/beefcafe",
    });
  });

  it("withdraws using the note and returns the tx (200)", async () => {
    const res = await POST(jsonReq({ note: NOTE, recipient: GOOD_RECIPIENT }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txHash).toBe("beefcafe");
    expect(assertCsrf).toHaveBeenCalled();
    expect(createPoolWithdraw).toHaveBeenCalledWith({ note: NOTE, recipient: GOOD_RECIPIENT });
  });

  it("404s when the rail is disabled", async () => {
    envMock.ENABLE_POOL_RAIL = false;
    const res = await POST(jsonReq({ note: NOTE, recipient: GOOD_RECIPIENT }));
    expect(res.status).toBe(404);
    expect(createPoolWithdraw).not.toHaveBeenCalled();
  });

  it("returns 403 when CSRF fails", async () => {
    assertCsrf.mockImplementation(() => {
      throw new AppError(403, "CSRF check failed");
    });
    const res = await POST(jsonReq({ note: NOTE, recipient: GOOD_RECIPIENT }));
    expect(res.status).toBe(403);
    expect(createPoolWithdraw).not.toHaveBeenCalled();
  });

  it("rejects a note with the wrong prefix (422) before touching the pool", async () => {
    const res = await POST(jsonReq({ note: "not-a-note", recipient: GOOD_RECIPIENT }));
    expect(res.status).toBe(422);
    expect(createPoolWithdraw).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient address (422)", async () => {
    const res = await POST(jsonReq({ note: NOTE, recipient: "not-a-stellar-key" }));
    expect(res.status).toBe(422);
    expect(createPoolWithdraw).not.toHaveBeenCalled();
  });

  it("surfaces an unknown-note service error as 422", async () => {
    createPoolWithdraw.mockRejectedValue(new AppError(422, "Unknown note", "not in pool"));
    const res = await POST(jsonReq({ note: NOTE, recipient: GOOD_RECIPIENT }));
    expect(res.status).toBe(422);
  });
});

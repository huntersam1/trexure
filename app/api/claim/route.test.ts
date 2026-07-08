import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

import { NOTE_PREFIX } from "@/lib/pool/note";

// Hoisted mock fns (vi.mock factories run before top-level consts).
const { requireReceiver, assertCsrf, submitClaim, envMock } = vi.hoisted(() => ({
  requireReceiver: vi.fn(),
  assertCsrf: vi.fn(),
  submitClaim: vi.fn(),
  envMock: { ENABLE_POOL_RAIL: true },
}));

vi.mock("@/lib/receiver/session", () => ({ requireReceiver }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("@/lib/receiver/claim", () => ({ submitClaim }));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { POST } from "@/app/api/claim/route";
import { AppError } from "@/lib/http/problem";

const VALID_NOTE = NOTE_PREFIX + "a".repeat(192);
const G = Keypair.random().publicKey();
const walletBody = { note: VALID_NOTE, payout: { method: "wallet", address: G } };

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/claim", () => {
  beforeEach(() => {
    envMock.ENABLE_POOL_RAIL = true;
    requireReceiver.mockReset().mockResolvedValue({ id: "r1", email: "alice@example.com" });
    assertCsrf.mockReset();
    submitClaim.mockReset().mockResolvedValue({
      method: "wallet",
      txHash: "deadbeef",
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/deadbeef",
    });
  });

  it("404s when the rail is disabled and never authenticates", async () => {
    envMock.ENABLE_POOL_RAIL = false;
    const res = await POST(jsonReq(walletBody));
    expect(res.status).toBe(404);
    expect(requireReceiver).not.toHaveBeenCalled();
    expect(submitClaim).not.toHaveBeenCalled();
  });

  it("401s without a receiver session (tenant users can't claim)", async () => {
    requireReceiver.mockRejectedValue(new AppError(401, "Unauthorized", "Receiver authentication required."));
    const res = await POST(jsonReq(walletBody));
    expect(res.status).toBe(401);
    expect(submitClaim).not.toHaveBeenCalled();
  });

  it("403s when CSRF fails", async () => {
    assertCsrf.mockImplementation(() => {
      throw new AppError(403, "CSRF check failed");
    });
    const res = await POST(jsonReq(walletBody));
    expect(res.status).toBe(403);
    expect(submitClaim).not.toHaveBeenCalled();
  });

  it("422s on an invalid claim (bad note)", async () => {
    const res = await POST(jsonReq({ note: "nope", payout: { method: "wallet", address: G } }));
    expect(res.status).toBe(422);
    expect(submitClaim).not.toHaveBeenCalled();
  });

  it("dispatches a valid wallet claim to the receiver id (200)", async () => {
    const res = await POST(jsonReq(walletBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txHash).toBe("deadbeef");
    expect(submitClaim).toHaveBeenCalledWith("r1", { note: VALID_NOTE, payout: { method: "wallet", address: G } });
  });

  it("passes through the P4/P5 not-implemented boundary (501)", async () => {
    submitClaim.mockRejectedValue(new AppError(501, "Not implemented yet", "Wallet claims are wired in P4 (#86)."));
    const res = await POST(jsonReq(walletBody));
    expect(res.status).toBe(501);
  });
});

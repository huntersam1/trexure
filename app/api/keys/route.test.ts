import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above top-level declarations; these factories reference the
// mock fns eagerly, so create them via vi.hoisted() to avoid a TDZ ReferenceError.
const { requireSession, assertCsrf, apiKeyCreate, auditCreate } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assertCsrf: vi.fn(),
  apiKeyCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("@/lib/db", () => ({
  forTenant: () => ({ apiKey: { create: apiKeyCreate } }),
  prisma: { auditLog: { create: auditCreate } },
}));
vi.mock("@/lib/auth/api-key", () => ({
  generateApiKey: () => ({ plaintext: "trx_sk_PLAINTEXT_ONCE", keyHash: "deadbeef" }),
}));

import { POST } from "@/app/api/keys/route";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/keys", () => {
  beforeEach(() => {
    requireSession.mockReset();
    assertCsrf.mockReset();
    apiKeyCreate.mockReset();
    auditCreate.mockReset();
    requireSession.mockResolvedValue({ id: "u1", tenantId: "tenant_1", role: "MEMBER" });
    apiKeyCreate.mockResolvedValue({ id: "key_1", name: "CI", createdAt: new Date("2026-06-30T00:00:00Z") });
  });

  it("creates a key, returns the plaintext once, stores only the hash, and audit-logs", async () => {
    const res = await POST(jsonReq({ name: "CI" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.plaintext).toBe("trx_sk_PLAINTEXT_ONCE");
    expect(body.id).toBe("key_1");

    expect(assertCsrf).toHaveBeenCalled();
    // Only the hash is persisted — never the plaintext.
    expect(apiKeyCreate).toHaveBeenCalledWith({ data: { name: "CI", keyHash: "deadbeef" } });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant_1",
        userId: "u1",
        action: "apikey.create",
        target: "key_1",
      }),
    });
  });

  it("rejects unknown fields with 400 (strict schema)", async () => {
    const res = await POST(jsonReq({ name: "CI", role: "ADMIN" }));
    expect(res.status).toBe(400);
    expect(apiKeyCreate).not.toHaveBeenCalled();
  });

  it("returns 403 when CSRF assertion throws", async () => {
    const { AppError } = await import("@/lib/http/problem");
    assertCsrf.mockImplementation(() => {
      throw new AppError(403, "CSRF check failed");
    });
    const res = await POST(jsonReq({ name: "CI" }));
    expect(res.status).toBe(403);
    expect(apiKeyCreate).not.toHaveBeenCalled();
  });
});

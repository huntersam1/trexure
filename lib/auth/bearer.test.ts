import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so the mock fn exists before the hoisted vi.mock factory runs (TDZ).
const { resolveApiKey } = vi.hoisted(() => ({ resolveApiKey: vi.fn() }));
vi.mock("@/lib/auth/api-key", () => ({ resolveApiKey }));

import { requireApiKey } from "@/lib/auth/bearer";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/payments/p1/receipt", { headers });
}

describe("requireApiKey", () => {
  beforeEach(() => resolveApiKey.mockReset());

  it("returns the tenant for a valid Bearer key", async () => {
    resolveApiKey.mockResolvedValue({ tenantId: "tenant_1" });
    const out = await requireApiKey(req({ authorization: "Bearer trx_sk_good" }));
    expect(out).toEqual({ tenantId: "tenant_1" });
    expect(resolveApiKey).toHaveBeenCalledWith("Bearer trx_sk_good");
  });

  it("throws 401 when the Authorization header is missing", async () => {
    await expect(requireApiKey(req({}))).rejects.toMatchObject({ status: 401 });
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it("throws 401 when the key is invalid or revoked", async () => {
    resolveApiKey.mockResolvedValue(null);
    await expect(requireApiKey(req({ authorization: "Bearer bad" }))).rejects.toMatchObject({
      status: 401,
    });
  });
});

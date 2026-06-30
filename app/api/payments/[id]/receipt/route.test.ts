import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolveApiKey: vi.fn(),
  findUnique: vi.fn(),
  forTenant: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/auth/api-key", () => ({ resolveApiKey: h.resolveApiKey }));
vi.mock("@/lib/db", () => ({ forTenant: h.forTenant }));
vi.mock("@/lib/http/problem", () => ({
  problem: (status: number, title: string, detail?: string) =>
    new Response(JSON.stringify({ status, title, detail }), {
      status,
      headers: { "content-type": "application/problem+json" },
    }),
}));

import { GET } from "./route";

const receiptJson = { id: "rcpt_p1", paymentId: "p1", status: "settled" };

beforeEach(() => {
  h.getSessionUser.mockReset();
  h.resolveApiKey.mockReset();
  h.findUnique.mockReset();
  h.forTenant.mockReset();
  h.forTenant.mockReturnValue({ payment: { findUnique: h.findUnique } });
});

const params = { params: Promise.resolve({ id: "p1" }) };

describe("GET /api/payments/[id]/receipt", () => {
  it("returns the §6.4 JSON for a session user (tenant-scoped)", async () => {
    h.getSessionUser.mockResolvedValue({ id: "u1", tenantId: "t1", role: "MEMBER", username: "a" });
    h.findUnique.mockResolvedValue({ id: "p1", receipt: { json: receiptJson } });

    const res = await GET(new Request("http://x/api/payments/p1/receipt"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(receiptJson);
    expect(h.forTenant).toHaveBeenCalledWith("t1");
    expect(h.findUnique).toHaveBeenCalledWith({ where: { id: "p1" }, include: { receipt: true } });
  });

  it("resolves tenant from a Bearer API key when no session", async () => {
    h.getSessionUser.mockResolvedValue(null);
    h.resolveApiKey.mockResolvedValue({ tenantId: "t2" });
    h.findUnique.mockResolvedValue({ id: "p1", receipt: { json: receiptJson } });

    const res = await GET(
      new Request("http://x/api/payments/p1/receipt", { headers: { authorization: "Bearer sk_live_x" } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(h.resolveApiKey).toHaveBeenCalledWith("sk_live_x");
    expect(h.forTenant).toHaveBeenCalledWith("t2");
  });

  it("401 problem+json when neither session nor valid key", async () => {
    h.getSessionUser.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/payments/p1/receipt"), params);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("404 when the payment has no receipt (or is another tenant's)", async () => {
    h.getSessionUser.mockResolvedValue({ id: "u1", tenantId: "t1", role: "MEMBER", username: "a" });
    h.findUnique.mockResolvedValue(null); // tenant scope filtered it out
    const res = await GET(new Request("http://x/api/payments/p1/receipt"), params);
    expect(res.status).toBe(404);
  });
});

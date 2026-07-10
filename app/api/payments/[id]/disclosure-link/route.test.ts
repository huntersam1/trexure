import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  createDisclosureLink: vi.fn(),
  revokeDisclosureLink: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf: h.assertCsrf }));
vi.mock("@/lib/reports/disclosure-link", () => ({
  createDisclosureLink: h.createDisclosureLink,
  revokeDisclosureLink: h.revokeDisclosureLink,
}));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { POST, DELETE } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const ctx = { params: Promise.resolve({ id: "pay_1" }) };
const req = () => new Request("http://localhost/api/payments/pay_1/disclosure-link", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/payments/[id]/disclosure-link", () => {
  it("rejects a non-admin with 403 and never mints", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(h.createDisclosureLink).not.toHaveBeenCalled();
  });

  it("mints and returns the token once for an admin", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.createDisclosureLink.mockResolvedValue({ token: "tok_abc", url: "http://x/verify/tok_abc", expiresAt: "2026-08-09T00:00:00.000Z" });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: "tok_abc", url: "http://x/verify/tok_abc" });
    expect(h.assertCsrf).toHaveBeenCalled();
    expect(h.createDisclosureLink).toHaveBeenCalledWith("t1", "pay_1", "u_admin");
  });

  it("propagates a 409 for a non-settled payment", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.createDisclosureLink.mockRejectedValue(new AppError(409, "Not settled", "…"));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/payments/[id]/disclosure-link", () => {
  it("revokes for an admin", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.revokeDisclosureLink.mockResolvedValue(true);
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(h.revokeDisclosureLink).toHaveBeenCalledWith("t1", "pay_1", "u_admin");
  });

  it("rejects a non-admin with 403", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(403);
    expect(h.revokeDisclosureLink).not.toHaveBeenCalled();
  });
});

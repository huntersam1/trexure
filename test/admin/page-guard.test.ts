import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("../../lib/auth/session", () => ({ requireSession }));
// notFound() throws a sentinel we can assert on (mirrors Next's control-flow throw).
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("../../lib/admin/queries", () => ({
  listTenantsWithCounts: vi.fn().mockResolvedValue([]),
  listWebhookEvents: vi.fn().mockResolvedValue([]),
  recentAuditLogs: vi.fn().mockResolvedValue([]),
}));
// The admin page reads the CSRF cookie server-side to pass to the create-user
// island, so cookies() must be available in the test's non-request context.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "csrf.token" }) }) }));

import AdminPage from "../../app/admin/page";

describe("/admin page guard (#143 C1: platform-operator only)", () => {
  beforeEach(() => requireSession.mockReset());

  it("renders for a platform admin", async () => {
    requireSession.mockResolvedValue({ id: "u_admin", role: "ADMIN", tenantId: "t_hq", username: "admin", isPlatformAdmin: true });
    const el = await AdminPage();
    expect(el).toBeTruthy();
  });

  it("404s a tenant ADMIN who is not a platform admin (no cross-tenant leak)", async () => {
    requireSession.mockResolvedValue({ id: "u_tenant", role: "ADMIN", tenantId: "t_other", username: "villain", isPlatformAdmin: false });
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

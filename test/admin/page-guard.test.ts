import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("../../lib/auth/session", () => ({ requireAdmin }));
vi.mock("../../lib/admin/queries", () => ({
  listTenantsWithCounts: vi.fn().mockResolvedValue([]),
  listWebhookEvents: vi.fn().mockResolvedValue([]),
  recentAuditLogs: vi.fn().mockResolvedValue([]),
}));
// The admin page reads the CSRF cookie server-side to pass to the create-user
// island, so cookies() must be available in the test's non-request context.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "csrf.token" }) }) }));

import AdminPage from "../../app/admin/page";

describe("/admin page guard", () => {
  beforeEach(() => requireAdmin.mockReset());

  it("is role-gated by requireAdmin (its 403 path is covered by the admin route tests)", async () => {
    requireAdmin.mockResolvedValue({ id: "u_admin", role: "ADMIN", tenantId: "t_hq", username: "admin" });
    const el = await AdminPage();
    // requireAdmin runs first and throws AppError(403) for non-admins; here it
    // resolves, the page renders, and we assert the gate was invoked.
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(el).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../lib/http/problem";

const { requireAdmin, listTenantsWithCounts, recordAudit } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listTenantsWithCounts: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/auth/session", () => ({ requireAdmin }));
vi.mock("../../lib/admin/queries", () => ({ listTenantsWithCounts }));
vi.mock("../../lib/audit/log", () => ({ recordAudit }));

import { GET } from "../../app/api/admin/tenants/route";

describe("GET /api/admin/tenants", () => {
  beforeEach(() => { requireAdmin.mockReset(); listTenantsWithCounts.mockReset(); recordAudit.mockClear(); });

  it("returns 403 problem+json for a non-admin", async () => {
    requireAdmin.mockRejectedValue(new AppError(403, "Forbidden"));
    const res = await GET(new Request("https://app.test/api/admin/tenants"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(listTenantsWithCounts).not.toHaveBeenCalled();
  });

  it("returns tenants with user counts for an admin and audits the read", async () => {
    requireAdmin.mockResolvedValue({ id: "u_admin", role: "ADMIN", tenantId: "t_hq", username: "admin" });
    listTenantsWithCounts.mockResolvedValue([{ id: "t_1", name: "Acme", userCount: 3, createdAt: new Date("2026-01-01T00:00:00Z") }]);
    const res = await GET(new Request("https://app.test/api/admin/tenants"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenants[0]).toMatchObject({ id: "t_1", name: "Acme", userCount: 3 });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.tenants.list", userId: "u_admin" }));
  });
});

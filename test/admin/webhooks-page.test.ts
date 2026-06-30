import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAdmin, listWebhookEvents } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listWebhookEvents: vi.fn(),
}));
vi.mock("../../lib/auth/session", () => ({ requireAdmin }));
vi.mock("../../lib/admin/queries", () => ({ listWebhookEvents }));

import AdminWebhooksPage from "../../app/admin/webhooks/page";

describe("/admin/webhooks", () => {
  beforeEach(() => { requireAdmin.mockReset(); listWebhookEvents.mockReset(); });

  it("loads the raw webhook event log for an admin and is gated by requireAdmin", async () => {
    requireAdmin.mockResolvedValue({ id: "u_admin", role: "ADMIN" });
    listWebhookEvents.mockResolvedValue([
      { id: "wh_1", provider: "mock-anchor", externalId: "evt_a", verified: true, processedAt: new Date(), createdAt: new Date() },
    ]);
    const el = await AdminWebhooksPage();
    // requireAdmin runs first (throws AppError(403) for non-admins; that path is
    // covered by the admin route tests). Here it resolves and the page renders.
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(listWebhookEvents).toHaveBeenCalled();
    expect(el).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireSession, listWebhookEvents } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  listWebhookEvents: vi.fn(),
}));
vi.mock("../../lib/auth/session", () => ({ requireSession }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("../../lib/admin/queries", () => ({ listWebhookEvents }));

import AdminWebhooksPage from "../../app/admin/webhooks/page";

describe("/admin/webhooks (#143 C1: platform-operator only)", () => {
  beforeEach(() => { requireSession.mockReset(); listWebhookEvents.mockReset(); });

  it("loads the raw webhook event log for a platform admin", async () => {
    requireSession.mockResolvedValue({ id: "u_admin", role: "ADMIN", isPlatformAdmin: true });
    listWebhookEvents.mockResolvedValue([
      { id: "wh_1", provider: "mock-anchor", externalId: "evt_a", verified: true, processedAt: new Date(), createdAt: new Date() },
    ]);
    const el = await AdminWebhooksPage();
    expect(listWebhookEvents).toHaveBeenCalled();
    expect(el).toBeTruthy();
  });

  it("404s a non-platform-admin and never reads the global webhook log", async () => {
    requireSession.mockResolvedValue({ id: "u_tenant", role: "ADMIN", isPlatformAdmin: false });
    await expect(AdminWebhooksPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listWebhookEvents).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../lib/http/problem";

const { requirePlatformAdmin, listWebhookEvents, recordAudit } = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  listWebhookEvents: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/auth/session", () => ({ requirePlatformAdmin }));
vi.mock("../../lib/admin/queries", () => ({ listWebhookEvents }));
vi.mock("../../lib/audit/log", () => ({ recordAudit }));

import { GET } from "../../app/api/admin/webhook-events/route";

describe("GET /api/admin/webhook-events", () => {
  beforeEach(() => { requirePlatformAdmin.mockReset(); listWebhookEvents.mockReset(); recordAudit.mockClear(); });

  it("returns 403 for a non-platform-admin (C1: the global webhook log is operator-only)", async () => {
    requirePlatformAdmin.mockRejectedValue(new AppError(403, "Forbidden"));
    const res = await GET(new Request("https://app.test/api/admin/webhook-events"));
    expect(res.status).toBe(403);
  });

  it("surfaces verification status and idempotency outcome", async () => {
    requirePlatformAdmin.mockResolvedValue({ id: "u_admin", role: "ADMIN", isPlatformAdmin: true });
    listWebhookEvents.mockResolvedValue([
      { id: "wh_1", provider: "mock-anchor", externalId: "evt_a", verified: true, processedAt: new Date("2026-02-01T00:00:00Z"), createdAt: new Date("2026-02-01T00:00:00Z") },
      { id: "wh_2", provider: "mock-anchor", externalId: "evt_b", verified: false, processedAt: null, createdAt: new Date("2026-02-02T00:00:00Z") },
    ]);
    const res = await GET(new Request("https://app.test/api/admin/webhook-events?limit=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events[0]).toMatchObject({ verified: true, idempotency: "processed" });
    expect(body.events[1]).toMatchObject({ verified: false, idempotency: "pending" });
    expect(listWebhookEvents).toHaveBeenCalledWith(50);
  });
});

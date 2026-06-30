import { describe, it, expect, vi, beforeEach } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: "aud_1" }) }));
vi.mock("../../lib/db", () => ({ prisma: { auditLog: { create } } }));
vi.mock("../../lib/log", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { recordAudit } from "../../lib/audit/log";

describe("recordAudit", () => {
  beforeEach(() => create.mockClear());

  it("persists an audit row with action + metadata", async () => {
    await recordAudit({ action: "admin.user.create", tenantId: "t_1", userId: "u_1", target: "u_2", metadata: { role: "MEMBER" } });
    expect(create).toHaveBeenCalledWith({
      data: { action: "admin.user.create", tenantId: "t_1", userId: "u_1", target: "u_2", metadata: { role: "MEMBER" }, ip: null },
    });
  });

  it("allows a global (null-tenant) platform action", async () => {
    await recordAudit({ action: "admin.tenants.list" });
    expect(create).toHaveBeenCalledWith({
      data: { action: "admin.tenants.list", tenantId: null, userId: null, target: undefined, metadata: undefined, ip: null },
    });
  });

  it("never throws if the audit write fails (best-effort)", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(recordAudit({ action: "x" })).resolves.toBeUndefined();
  });
});

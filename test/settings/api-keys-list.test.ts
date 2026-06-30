import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, forTenant } = vi.hoisted(() => {
  const findMany = vi.fn();
  return { findMany, forTenant: vi.fn(() => ({ apiKey: { findMany } })) };
});
vi.mock("../../lib/db", () => ({ forTenant }));
vi.mock("../../lib/auth/session", () => ({ requireSession: vi.fn() }));

import { listTenantApiKeys } from "../../app/(app)/settings/api-keys/page";

describe("listTenantApiKeys", () => {
  beforeEach(() => { findMany.mockReset(); forTenant.mockClear(); });

  it("queries through forTenant and never selects keyHash", async () => {
    findMany.mockResolvedValue([
      { id: "k_1", name: "CI", lastUsedAt: new Date("2026-03-01T00:00:00Z"), revokedAt: null, createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    const keys = await listTenantApiKeys("t_A");
    expect(forTenant).toHaveBeenCalledWith("t_A");
    const select = findMany.mock.calls[0]![0].select;
    expect(select.keyHash).toBeUndefined();
    expect(keys[0]).toMatchObject({ id: "k_1", name: "CI", revokedAt: null });
    expect(keys[0]).not.toHaveProperty("keyHash");
  });
});

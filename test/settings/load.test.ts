import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, findFirst, forTenant } = vi.hoisted(() => {
  const findUnique = vi.fn();
  const findFirst = vi.fn();
  return { findUnique, findFirst, forTenant: vi.fn(() => ({ viewKey: { findUnique }, anchorConfig: { findFirst } })) };
});
vi.mock("../../lib/db", () => ({ forTenant }));

import { getSettingsView } from "../../lib/settings/load";

describe("getSettingsView", () => {
  beforeEach(() => { findUnique.mockReset(); findFirst.mockReset(); forTenant.mockClear(); });

  it("returns a redacted view with NO key material when a view key exists", async () => {
    findUnique.mockResolvedValue({ encryptedKey: Buffer.from("ciphertext-bytes"), nonce: Buffer.from("noncebytes12") });
    findFirst.mockResolvedValue({ provider: "mock-anchor" });
    const view = await getSettingsView("t_1");
    expect(forTenant).toHaveBeenCalledWith("t_1");
    expect(view.hasViewKey).toBe(true);
    expect(view.anchor).toEqual({ provider: "mock-anchor" });
    // Crucial: nothing in the serialized view leaks ciphertext/nonce/plaintext.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("ciphertext-bytes");
    expect(serialized).not.toContain("noncebytes12");
    expect(view).not.toHaveProperty("encryptedKey");
    expect(view.viewKeyFingerprint).toMatch(/^[0-9a-f]{4}$/);
  });

  it("reports no view key / no anchor cleanly", async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    const view = await getSettingsView("t_1");
    expect(view).toEqual({ hasViewKey: false, viewKeyFingerprint: null, anchor: null });
  });
});

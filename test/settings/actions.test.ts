import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireSession, storeViewKey, aesEncrypt, upsert, update, forTenant, recordAudit } = vi.hoisted(() => {
  const upsert = vi.fn().mockResolvedValue({ id: "anc_1" });
  const update = vi.fn().mockResolvedValue({ id: "anc_1" });
  return {
    requireSession: vi.fn(),
    storeViewKey: vi.fn().mockResolvedValue(undefined),
    aesEncrypt: vi.fn(() => ({ ciphertext: Buffer.from("CIPHER"), nonce: Buffer.from("NONCE12bytes") })),
    upsert,
    update,
    forTenant: vi.fn(() => ({
      anchorConfig: { upsert, update, findFirst: vi.fn().mockResolvedValue({ id: "anc_1", provider: "mock-anchor" }) },
    })),
    recordAudit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../lib/auth/session", () => ({ requireSession }));
vi.mock("../../lib/crypto/viewkey", () => ({ storeViewKey }));
vi.mock("../../lib/crypto/aes", () => ({ aesEncrypt }));
vi.mock("../../lib/db", () => ({ forTenant }));
vi.mock("../../lib/audit/log", () => ({ recordAudit }));

import { saveViewKeyAction, saveAnchorConfigAction, rotateWebhookSecretAction } from "../../lib/settings/actions";

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("settings server actions", () => {
  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue({ id: "u_1", tenantId: "t_A", role: "MEMBER" });
    storeViewKey.mockClear(); aesEncrypt.mockClear(); upsert.mockClear(); update.mockClear(); forTenant.mockClear(); recordAudit.mockClear();
  });

  it("saveViewKeyAction stores via storeViewKey using the SESSION tenant, never the form tenant", async () => {
    const res = await saveViewKeyAction(null, fd({ viewKey: "SK-view-key-abcdef0123456789", tenantId: "t_B" }));
    expect(res.ok).toBe(true);
    // t_A from session, not t_B; the text is stored as its UTF-8 bytes.
    expect(storeViewKey).toHaveBeenCalledWith("t_A", Buffer.from("SK-view-key-abcdef0123456789", "utf8"));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "viewkey.update", tenantId: "t_A", userId: "u_1" }));
  });

  it("saveViewKeyAction rejects an empty/short key without writing", async () => {
    const res = await saveViewKeyAction(null, fd({ viewKey: "short" }));
    expect(res.ok).toBe(false);
    expect(storeViewKey).not.toHaveBeenCalled();
  });

  it("saveAnchorConfigAction encrypts the webhook secret at rest (nonce-prefixed) scoped to the session tenant", async () => {
    const res = await saveAnchorConfigAction(null, fd({ provider: "mock-anchor", webhookSecret: "anchor-secret-1" }));
    expect(res.ok).toBe(true);
    expect(forTenant).toHaveBeenCalledWith("t_A");
    expect(aesEncrypt).toHaveBeenCalledWith(Buffer.from("anchor-secret-1"));
    const data = upsert.mock.calls[0]![0].create;
    expect(Buffer.isBuffer(data.webhookSecret)).toBe(true);
    // nonce (12) prefixed onto ciphertext; raw secret never persisted in the clear
    expect(data.webhookSecret.subarray(0, 12).equals(Buffer.from("NONCE12bytes"))).toBe(true);
    expect(data.webhookSecret.toString()).not.toContain("anchor-secret-1");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "anchor.config.update", tenantId: "t_A" }));
  });

  it("rotateWebhookSecretAction generates a fresh secret, reveals it once, and audits the rotation", async () => {
    const res = await rotateWebhookSecretAction(null, fd({}));
    expect(res.ok).toBe(true);
    expect("revealOnce" in res && typeof res.revealOnce === "string" && res.revealOnce.length >= 32).toBe(true);
    expect(aesEncrypt).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "anchor.secret.rotate", tenantId: "t_A" }));
  });
});

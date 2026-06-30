import "server-only";
import { createHash } from "node:crypto";
import { forTenant } from "../db";

export interface SettingsView {
  hasViewKey: boolean;
  viewKeyFingerprint: string | null;
  anchor: { provider: "mock-anchor" | "xendit" } | null;
}

/**
 * Returns ONLY non-secret, display-safe data. The view key plaintext, ciphertext,
 * and nonce never leave this module — `viewKeyFingerprint` is the last 4 hex chars of
 * sha256(ciphertext) so the UI can render a stable truncated chip (BRAND §12).
 */
export async function getSettingsView(tenantId: string): Promise<SettingsView> {
  const db = forTenant(tenantId);
  const [vk, anchor] = await Promise.all([
    db.viewKey.findUnique({ where: { tenantId }, select: { encryptedKey: true } }),
    db.anchorConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { provider: true } }),
  ]);

  const fingerprint = vk?.encryptedKey
    ? createHash("sha256").update(Buffer.from(vk.encryptedKey)).digest("hex").slice(-4)
    : null;

  return {
    hasViewKey: Boolean(vk),
    viewKeyFingerprint: fingerprint,
    anchor: anchor ? { provider: anchor.provider as "mock-anchor" | "xendit" } : null,
  };
}

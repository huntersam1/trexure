import "server-only";
import { prisma } from "@/lib/db";
import { aesDecrypt } from "@/lib/crypto/aes";

/**
 * Decrypt a tenant's stored anchor webhook secret (#143 H1). Webhook handlers
 * verify against THIS (per-tenant) secret, not one global token, so a forged
 * global token can't authenticate every tenant and a UI-rotated secret actually
 * takes effect.
 *
 * `AnchorConfig.webhookSecret` is persisted in one of two shapes:
 *   - settings save/rotate: `nonce(12) || ciphertext(+tag)` (self-contained)
 *   - seed / self-signup:   `ciphertext(+tag)`, nonce in `config.nonce` (base64)
 * The presence of `config.nonce` discriminates. Returns null when there's no
 * config or it can't be decrypted, so the caller can fall back to the env token.
 *
 * Uses base `prisma` (webhook requests carry no session); the tenant is resolved
 * from the referenced payment and passed in explicitly.
 */
export async function loadAnchorWebhookSecret(tenantId: string, provider: string): Promise<string | null> {
  const cfg = await prisma.anchorConfig.findFirst({
    where: { tenantId, provider },
    select: { webhookSecret: true, config: true },
  });
  if (!cfg?.webhookSecret) return null;

  const buf = Buffer.from(cfg.webhookSecret);
  const cfgNonce = (cfg.config as { nonce?: string } | null)?.nonce;
  try {
    if (cfgNonce) {
      return aesDecrypt(buf, Buffer.from(cfgNonce, "base64")).toString("utf8");
    }
    // Nonce-prefixed layout: first 12 bytes are the GCM nonce.
    return aesDecrypt(buf.subarray(12), buf.subarray(0, 12)).toString("utf8");
  } catch {
    return null;
  }
}

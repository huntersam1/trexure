import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const KEY_PREFIX = "trx_sk_";

/** SHA-256 hex digest. Only the hash is ever persisted. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Mint a new API key. The plaintext is returned once and never stored. */
export function generateApiKey(): { plaintext: string; keyHash: string } {
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, keyHash: hashApiKey(plaintext) };
}

/**
 * Resolve an Authorization value (with or without a "Bearer " prefix) to a tenant.
 * Hashes the token, looks up a non-revoked key, stamps lastUsedAt, returns the tenant.
 */
export async function resolveApiKey(bearer: string): Promise<{ tenantId: string } | null> {
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : bearer.trim();
  if (!token.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashApiKey(token);
  const key = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!key || key.revokedAt) return null;

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { tenantId: key.tenantId };
}

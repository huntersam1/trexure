import "server-only";
import { prisma } from "@/lib/db";
import { aesEncrypt, aesDecrypt } from "@/lib/crypto/aes";
import { AppError } from "@/lib/http/problem";

/**
 * Encrypt and persist a tenant's view key at rest (AES-256-GCM, per-record nonce).
 * Write-only: the plaintext is never returned to any caller after storage.
 */
// Prisma 7's `Bytes` input type is `Uint8Array<ArrayBuffer>`; Node `Buffer`s are
// `Buffer<ArrayBufferLike>` and aren't assignable under strict TS even though a
// Buffer *is* a Uint8Array at runtime. Assert the type at the persistence
// boundary; the value stays a Buffer (Prisma accepts it at runtime).
const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => b as unknown as Uint8Array<ArrayBuffer>;

export async function storeViewKey(tenantId: string, viewKey: Buffer): Promise<void> {
  const { ciphertext, nonce } = aesEncrypt(viewKey);
  await prisma.viewKey.upsert({
    where: { tenantId },
    create: { tenantId, encryptedKey: asBytes(ciphertext), nonce: asBytes(nonce) },
    update: { encryptedKey: asBytes(ciphertext), nonce: asBytes(nonce) },
  });
}

/**
 * Load and decrypt a tenant's view key server-side. Returns a Buffer that callers
 * must use in-process only — it must NEVER be placed in an API response or a log.
 */
export async function loadViewKey(tenantId: string): Promise<Buffer> {
  const row = await prisma.viewKey.findUnique({ where: { tenantId } });
  if (!row) {
    throw new AppError(404, "View key not found", "No view key is configured for this tenant.");
  }
  return aesDecrypt(Buffer.from(row.encryptedKey), Buffer.from(row.nonce));
}

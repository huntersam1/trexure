import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const KEY_BYTES = 32; // AES-256
const NONCE_BYTES = 12; // GCM standard
const TAG_BYTES = 16; // GCM auth tag

function masterKey(): Buffer {
  const key = Buffer.from(env.MASTER_ENCRYPTION_KEY, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/**
 * AES-256-GCM. Returns ciphertext with the 16-byte auth tag appended, plus the nonce.
 * Encrypts under the master key by default, or an explicit 32-byte key (e.g. a tenant
 * view key) — the single source of truth for the on-disk convention so callers that
 * wrap under a non-master key don't hand-roll a divergent copy.
 */
export function aesEncrypt(plaintext: Buffer, key?: Buffer): { ciphertext: Buffer; nonce: Buffer } {
  const encKey = key ?? masterKey();
  if (encKey.length !== KEY_BYTES) {
    throw new Error(`AES key must be ${KEY_BYTES} bytes (got ${encKey.length})`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encKey, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([body, tag]), nonce };
}

/** Reverses aesEncrypt. Throws if the appended tag does not verify (tamper detection). */
export function aesDecrypt(ciphertext: Buffer, nonce: Buffer): Buffer {
  if (ciphertext.length < TAG_BYTES) {
    throw new Error("ciphertext too short to contain an auth tag");
  }
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

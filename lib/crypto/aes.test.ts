import { describe, it, expect, vi } from "vitest";

// 32-byte key, base64 — mock env so no real .env is required.
// vi.hoisted so TEST_KEY exists before the hoisted vi.mock factory runs (TDZ).
const { TEST_KEY } = vi.hoisted(() => ({ TEST_KEY: Buffer.alloc(32, 7).toString("base64") }));
vi.mock("@/lib/env", () => ({ env: { MASTER_ENCRYPTION_KEY: TEST_KEY } }));

import { aesEncrypt, aesDecrypt } from "@/lib/crypto/aes";

describe("aes-256-gcm", () => {
  it("round-trips plaintext", () => {
    const plaintext = Buffer.from("super-secret-view-key", "utf8");
    const { ciphertext, nonce } = aesEncrypt(plaintext);

    expect(nonce).toHaveLength(12);
    expect(ciphertext.equals(plaintext)).toBe(false); // actually encrypted
    expect(ciphertext.length).toBe(plaintext.length + 16); // tag appended

    const decrypted = aesDecrypt(ciphertext, nonce);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("uses a fresh nonce per call", () => {
    const a = aesEncrypt(Buffer.from("x"));
    const b = aesEncrypt(Buffer.from("x"));
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects a tampered ciphertext (auth tag fails)", () => {
    const { ciphertext, nonce } = aesEncrypt(Buffer.from("intact"));
    const tampered = Buffer.from(ciphertext);
    tampered[0] = tampered[0]! ^ 0xff; // flip a byte
    expect(() => aesDecrypt(tampered, nonce)).toThrow();
  });

  it("rejects a tampered nonce", () => {
    const { ciphertext, nonce } = aesEncrypt(Buffer.from("intact"));
    const badNonce = Buffer.from(nonce);
    badNonce[0] = badNonce[0]! ^ 0xff;
    expect(() => aesDecrypt(ciphertext, badNonce)).toThrow();
  });
});

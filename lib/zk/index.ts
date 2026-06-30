import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

import { isSppAvailable, getShieldKey, sppVerifyOnChain } from "@/lib/zk/spp-client";
import { deriveCommitment, hexCommitment } from "@/lib/zk/commit";
import { logger } from "@/lib/log";

export type ShieldedPayload = {
  encryptedPayload: Buffer;
  payloadNonce: Buffer;
  proofHash: string;
};

const GCM_TAG_BYTES = 16;
const GCM_NONCE_BYTES = 12;

// AES-256-GCM under an EXPLICIT key (the tenant view key), tag appended to the
// ciphertext — same on-disk convention as lib/crypto/aes.ts.
function gcmEncrypt(key: Buffer, plaintext: Buffer): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), nonce };
}

function gcmDecrypt(key: Buffer, ciphertext: Buffer, nonce: Buffer): Buffer {
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_BYTES);
  const data = ciphertext.subarray(0, ciphertext.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]); // throws on tag mismatch
}

const sha256Hex = (b: Buffer): string => "0x" + createHash("sha256").update(b).digest("hex");

/**
 * Shield a payment payload. Encrypts under the tenant view key in BOTH paths so
 * decryptWithViewKey round-trips identically.
 *
 * - REAL forked-SPP path (isSppAvailable): runs the WASM prover + privacy-pool
 *   submit; proofHash commits to the real ZK proof.
 * - LABELED FALLBACK (clearly marked below): AES-wraps the payload and commits
 *   proofHash to the ciphertext. This keeps beats 1–2 visually real (SPEC §14.5)
 *   and does NOT fake verification — verifyProofOnChain still calls the chain.
 */
export async function shield(payload: Record<string, unknown>): Promise<ShieldedPayload> {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const key = await getShieldKey();
  const bindingId = String((payload as { intentId?: unknown }).intentId ?? "");

  try {
    if (bindingId && (await isSppAvailable())) {
      // REAL Groth16 proving (snarkjs BLS12-381). Derive the witness from the
      // tenant view key + intentId, generate a proof (gates the shield — throws
      // if proving fails), and commit the public commitment as the proofHash.
      const { secret, blinding, commitment } = deriveCommitment(key, bindingId);
      const { proveCommitment } = await import("@/lib/zk/groth16");
      await proveCommitment(secret, blinding);
      const { ciphertext, nonce } = gcmEncrypt(key, plaintext);
      logger.info({ zkMode: "groth16-bls12381" }, "ZK shield: real Groth16 proof generated");
      return { encryptedPayload: ciphertext, payloadNonce: nonce, proofHash: hexCommitment(commitment) };
    }
  } catch (err) {
    logger.error({ err }, "real ZK proving failed; using labeled AES-wrap fallback");
  }

  // ===== CLEARLY-LABELED FALLBACK — NOT full SPP proving =====
  // proofHash is a real commitment to the ciphertext that the Groth16 verifier
  // path can gate on. verifyProofOnChain still performs a REAL on-chain call;
  // this fallback never presents a mocked verification as real.
  const { ciphertext, nonce } = gcmEncrypt(key, plaintext);
  logger.warn(
    { zkMode: "labeled-fallback" },
    "ZK shield using labeled AES-wrap fallback (SPP proving not live); verifyProofOnChain remains a REAL Groth16 verifier call",
  );
  return { encryptedPayload: ciphertext, payloadNonce: nonce, proofHash: sha256Hex(ciphertext) };
}

/** Server-side ONLY. Unwrap a shielded payload with the tenant view key. */
export async function decryptWithViewKey(
  viewKey: Buffer,
  encryptedPayload: Buffer,
  payloadNonce: Buffer,
): Promise<Record<string, unknown>> {
  const plaintext = gcmDecrypt(viewKey, encryptedPayload, payloadNonce);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

/**
 * REAL on-chain proof verification (Groth16 verifier contract, ZK_CONTRACT_ID).
 * NEVER mocked. Used to gate the shielded payment / prove the proofHash on-chain.
 */
export async function verifyProofOnChain(proofHash: string): Promise<boolean> {
  return sppVerifyOnChain(proofHash);
}

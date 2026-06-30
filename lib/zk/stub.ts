import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Frozen Phase 6 shape. Real ZK (forked SPP) lands in Phase 6 behind this exact type.
 */
export type ShieldedPayload = {
  encryptedPayload: Buffer;
  payloadNonce: Buffer;
  proofHash: string;
};

/**
 * ⚠️ STUB — NOT REAL ZK. Phase 3 placeholder so the payment spine works before the
 * forked-SPP ZK layer (Phase 6) lands. It deterministically serialises the payload and
 * derives a hash; it does NOT generate or verify a zero-knowledge proof. The returned
 * `proofHash` must NEVER be presented to a user as a verified on-chain proof. Phase 6
 * replaces this with `lib/zk` real shield()/verifyProofOnChain().
 */
export async function shield(payload: Record<string, unknown>): Promise<ShieldedPayload> {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadNonce = randomBytes(12);
  // Placeholder "encryption": XOR-free opaque blob = nonce-prefixed JSON. Phase 6 replaces.
  const encryptedPayload = Buffer.concat([payloadNonce, json]);
  const proofHash = createHash("sha256")
    .update(payloadNonce)
    .update(json)
    .digest("hex");
  return { encryptedPayload, payloadNonce, proofHash };
}

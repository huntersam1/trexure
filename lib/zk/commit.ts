import { createHash } from "node:crypto";

// BLS12-381 scalar field order. Shared by the prover, the on-chain verifier
// bridge, and the seed — NO "server-only" here so prisma/seed.ts (run under tsx)
// can import it too.
export const FR = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/**
 * Deterministically derive the ZK witness (secret, blinding) and the public
 * commitment for a payment from the tenant view key + a stable binding id
 * (the payment intentId). Only a holder of the view key can reproduce these,
 * so only the tenant can generate a valid proof — yet the secret never leaves
 * the server and never goes on-chain (only the commitment + proof do).
 *
 *   commitment = secret^2 + blinding   (mod r)
 */
export function deriveCommitment(
  viewKey: Buffer,
  bindingId: string,
): { secret: bigint; blinding: bigint; commitment: bigint } {
  const field = (tag: string): bigint => {
    const h = createHash("sha256").update(tag).update(viewKey).update(bindingId).digest("hex");
    return BigInt("0x" + h) % FR;
  };
  const secret = field("trexure-zk-secret/");
  const blinding = field("trexure-zk-blind/");
  const commitment = (((secret * secret) % FR) + blinding) % FR;
  return { secret, blinding, commitment };
}

/** The commitment rendered as the on-ledger 0x-prefixed 32-byte hex `proofHash`. */
export const hexCommitment = (commitment: bigint): string => "0x" + commitment.toString(16).padStart(64, "0");

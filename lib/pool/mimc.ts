import { createHash } from "node:crypto";
import { FR } from "../zk/commit";

/**
 * MiMC hash over the BLS12-381 scalar field (`Fr`) — the single source of truth
 * for the shielded pool (issue #60). The SAME construction is transcribed into
 * the circom circuit (P2) and the Soroban contract (P3); all three MUST agree
 * bit-for-bit, so this module is deliberately dependency-free (only `node:crypto`
 * for constant derivation) and pinned by golden vectors in `mimc.test.ts` /
 * `zk/artifacts/mimc-golden.json`.
 *
 * Construction: circomlib's **MiMCSponge** (Feistel permutation, S-box x^5)
 * — the same well-reviewed algorithm Tornado Cash uses on BN254 — with:
 *   - field       = BLS12-381 `Fr` (`FR`, from lib/zk/commit.ts)
 *   - exponent    = 5   (gcd(5, r-1) = 1, so x^5 is a permutation over Fr)
 *   - rounds      = 220 (circomlib convention; generous margin)
 *   - round const = SHA256("trexure-mimc-v1:" + i) mod r, with C[0]=C[N-1]=0
 *
 * We use our own SHA256-seeded constants (native, matches lib/zk/commit.ts
 * style) instead of circomlib's keccak-seeded ones so no keccak dependency is
 * needed; P2/P3 transcribe the exact constants emitted in the golden file.
 */

export const MIMC_EXPONENT = 5n;
export const MIMC_ROUNDS = 220;
export const MIMC_SEED = "trexure-mimc-v1";

const shaField = (tag: string): bigint =>
  BigInt("0x" + createHash("sha256").update(tag).digest("hex")) % FR;

/**
 * Round constants: C[0] and C[N-1] are 0 (circomlib convention); the interior
 * is SHA256 of the seed + index, reduced mod r. Computed once at module load.
 */
export const MIMC_CONSTANTS: readonly bigint[] = (() => {
  const c: bigint[] = new Array(MIMC_ROUNDS).fill(0n);
  for (let i = 1; i < MIMC_ROUNDS - 1; i++) c[i] = shaField(`${MIMC_SEED}:${i}`);
  return c;
})();

/** Normalize any field-ish input to a canonical residue in [0, r). */
export function toField(x: bigint | number | string): bigint {
  const v = typeof x === "bigint" ? x : BigInt(x);
  return ((v % FR) + FR) % FR;
}

const pow5 = (t: bigint): bigint => {
  const t2 = (t * t) % FR;
  const t4 = (t2 * t2) % FR;
  return (t4 * t) % FR;
};

/**
 * One MiMC-Feistel permutation over (xL, xR) keyed by k — a faithful port of
 * circomlib `MiMCFeistel(nRounds)`. S-box is t^5; the last round omits the swap.
 */
export function mimcFeistel(xLin: bigint, xRin: bigint, k: bigint): [bigint, bigint] {
  let xL = toField(xLin);
  let xR = toField(xRin);
  const key = toField(k);
  for (let i = 0; i < MIMC_ROUNDS; i++) {
    const t = i === 0 ? (key + xL) % FR : (key + xL + MIMC_CONSTANTS[i]!) % FR;
    const t5 = pow5(t);
    if (i < MIMC_ROUNDS - 1) {
      const newXL = (xR + t5) % FR;
      xR = xL;
      xL = newXL;
    } else {
      xR = (xR + t5) % FR; // final round: no swap
    }
  }
  return [xL, xR];
}

/**
 * MiMCSponge over `Fr`: absorb `inputs`, squeeze `nOutputs` field elements.
 * Faithful port of circomlib `MiMCSponge(nInputs, nRounds, nOutputs)` with k.
 */
export function mimcSponge(inputs: (bigint | number | string)[], nOutputs = 1, k: bigint = 0n): bigint[] {
  if (inputs.length === 0) throw new Error("mimcSponge: need at least one input");
  const key = toField(k);
  let xL = toField(inputs[0]!);
  let xR = 0n;
  [xL, xR] = mimcFeistel(xL, xR, key);
  for (let i = 1; i < inputs.length; i++) {
    xL = (xL + toField(inputs[i]!)) % FR;
    [xL, xR] = mimcFeistel(xL, xR, key);
  }
  const outs: bigint[] = [xL];
  for (let j = 1; j < nOutputs; j++) {
    [xL, xR] = mimcFeistel(xL, xR, key);
    outs.push(xL);
  }
  return outs;
}

/** Merkle-node hash: 2 → 1. */
export const hash2 = (left: bigint | number | string, right: bigint | number | string): bigint =>
  mimcSponge([left, right], 1, 0n)[0]!;

/**
 * Deposit leaf commitment: binds the note secret, its nullifier, and the amount.
 * Distinct absorb arity (3 inputs) domain-separates it from a Merkle node (2)
 * and the nullifier hash (1).
 */
export const commitmentHash = (
  secret: bigint | number | string,
  nullifier: bigint | number | string,
  amount: bigint | number | string,
): bigint => mimcSponge([secret, nullifier, amount], 1, 0n)[0]!;

/** Public nullifier hash: 1 → 1. Published at withdraw to prevent double-spend. */
export const nullifierHash = (nullifier: bigint | number | string): bigint =>
  mimcSponge([nullifier], 1, 0n)[0]!;

/** Field element → 0x-prefixed 32-byte big-endian hex (the on-chain BytesN<32> shape). */
export const toHex32 = (x: bigint): string => "0x" + toField(x).toString(16).padStart(64, "0");

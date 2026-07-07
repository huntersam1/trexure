import { FR } from "../zk/commit";
import type { Groth16Proof } from "../zk/groth16";

/**
 * snarkjs Groth16 proof → Soroban `ShieldedPool.withdraw` arguments (P4, #63).
 *
 * The byte layout is the one locked in for the deployed BLS12-381 verifier
 * (`lib/zk/groth16.ts`, brute-forced on testnet): big-endian, `Fp2` **c1-first**
 * (imaginary coordinate first), and proof.A **negated** off-chain. This is a
 * pure transform (no secrets), so it is not `server-only`; `withdraw.ts` submits
 * the result. Cross-checked byte-for-byte against the Rust contract fixture.
 */

// BLS12-381 base field (Fp) order.
const FP =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

/** Fp element → 48-byte big-endian. */
function feBE(dec: string | bigint): Buffer {
  const v = ((BigInt(dec) % FP) + FP) % FP;
  return Buffer.from(v.toString(16).padStart(96, "0"), "hex");
}
/** Fr element → 32-byte big-endian (the on-chain `BytesN<32>` shape). */
function frBE(dec: string | bigint): Buffer {
  const v = ((BigInt(dec) % FR) + FR) % FR;
  return Buffer.from(v.toString(16).padStart(64, "0"), "hex");
}
/** G1 point → 96 bytes (x‖y). */
const g1 = (p: string[]): Buffer => Buffer.concat([feBE(p[0]!), feBE(p[1]!)]);
/** G2 point → 192 bytes, each Fp2 coordinate c1-first (x1‖x0‖y1‖y0). */
const g2 = (p: string[][]): Buffer =>
  Buffer.concat([feBE(p[0]![1]!), feBE(p[0]![0]!), feBE(p[1]![1]!), feBE(p[1]![0]!)]);
/** G1 with the y-coordinate negated (the contract expects a pre-negated A). */
const negG1 = (p: string[]): Buffer => g1([p[0]!, (((FP - (BigInt(p[1]!) % FP)) % FP)).toString()]);

/** Withdraw public signals, in the circuit's fixed order. */
type WithdrawPublicSignals = [root: string, nullifierHash: string, recipient: string, amount: string];

export type EncodedWithdraw = {
  negA: Buffer; // BytesN<96>
  b: Buffer; // BytesN<192>
  c: Buffer; // BytesN<96>
  root: Buffer; // BytesN<32>
  nullifierHash: Buffer; // BytesN<32>
  recipientField: Buffer; // BytesN<32>
  amount: bigint; // i128
};

/**
 * Encode a withdraw proof + its public signals `[root, nullifierHash, recipient,
 * amount]` into the contract's argument bytes. `recipient` here is the field
 * element the circuit bound; the actual payout `Address` is supplied separately
 * at submit time (`withdraw.ts`) and the contract re-derives the field from it.
 */
export function encodeWithdrawProof(
  proof: Groth16Proof,
  publicSignals: string[],
): EncodedWithdraw {
  const [root, nullifierHash, recipient, amount] = publicSignals as WithdrawPublicSignals;
  return {
    negA: negG1(proof.pi_a),
    b: g2(proof.pi_b),
    c: g1(proof.pi_c),
    root: frBE(root),
    nullifierHash: frBE(nullifierHash),
    recipientField: frBE(recipient),
    amount: BigInt(amount),
  };
}

import "server-only";

import path from "node:path";
import { readFileSync } from "node:fs";

import { groth16 } from "snarkjs";
import {
  rpc,
  Contract,
  Keypair,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { env } from "@/lib/env";

// BLS12-381 base field (Fp) and scalar field (Fr) orders.
const FP = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
export const FR = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const ZK_DIR = path.join(process.cwd(), "zk", "artifacts");
const WASM_PATH = path.join(ZK_DIR, "commit.wasm");
const ZKEY_PATH = path.join(ZK_DIR, "commit_final.zkey");
type VerificationKey = { vk_alpha_1: string[]; vk_beta_2: string[][]; vk_gamma_2: string[][]; vk_delta_2: string[][]; IC: string[][] };
let _vk: VerificationKey | null = null;
const vk = (): VerificationKey => (_vk ??= JSON.parse(readFileSync(path.join(ZK_DIR, "vk.json"), "utf8")) as VerificationKey);

export type Groth16Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
};
export type ProofPackage = { proof: Groth16Proof; publicSignals: string[]; commitment: string };

// ---- snarkjs -> Soroban BLS12-381 encoding (big-endian, Fp2 c1-first; A negated
//      off-chain). Locked in by brute-forcing against a known-good proof on testnet
//      (see zk/deploy.json). ----
function feBE(dec: string | bigint): Buffer {
  let v = ((BigInt(dec) % FP) + FP) % FP;
  return Buffer.from(v.toString(16).padStart(96, "0"), "hex");
}
function frBE(dec: string | bigint): Buffer {
  return Buffer.from((BigInt(dec) % FR).toString(16).padStart(64, "0"), "hex");
}
const g1 = (p: string[]): Buffer => Buffer.concat([feBE(p[0]!), feBE(p[1]!)]); // 96 bytes
const g2 = (p: string[][]): Buffer =>
  Buffer.concat([feBE(p[0]![1]!), feBE(p[0]![0]!), feBE(p[1]![1]!), feBE(p[1]![0]!)]); // 192 bytes, c1-first
const negG1 = (p: string[]): Buffer => g1([p[0]!, (((FP - (BigInt(p[1]!) % FP)) % FP)).toString()]);

const scBytes = (b: Buffer) => nativeToScVal(b, { type: "bytes" });
const scVecBytes = (arr: Buffer[]) => xdr.ScVal.scvVec(arr.map(scBytes));

/** Generate a REAL Groth16 proof that the prover knows (secret, blinding) opening
 *  the public commitment = secret^2 + blinding (mod r). */
export async function proveCommitment(secret: bigint, blinding: bigint): Promise<ProofPackage> {
  const commitment = (((secret * secret) % FR) + (blinding % FR)) % FR;
  const { proof, publicSignals } = await groth16.fullProve(
    { secret: (secret % FR).toString(), blinding: (blinding % FR).toString(), commitment: commitment.toString() },
    WASM_PATH,
    ZKEY_PATH,
  );
  return { proof: proof as Groth16Proof, publicSignals: publicSignals as string[], commitment: commitment.toString() };
}

/** Verify off-chain with snarkjs (fast pre-check; not a substitute for on-chain). */
export async function verifyProofLocal(pkg: ProofPackage): Promise<boolean> {
  return groth16.verify(vk(), pkg.publicSignals, pkg.proof);
}

/**
 * REAL on-chain Groth16 verification: read-only simulation of `verify` against
 * the deployed BLS12-381 verifier (ZK_CONTRACT_ID). NEVER mocked — a simulation
 * error throws; the verifier returns true only for a valid proof.
 */
export async function verifyProofOnChain(pkg: ProofPackage): Promise<boolean> {
  if (!env.ZK_CONTRACT_ID) throw new Error("ZK_CONTRACT_ID not configured");
  const server = new rpc.Server(env.STELLAR_RPC_URL, { allowHttp: env.STELLAR_RPC_URL.startsWith("http://") });
  const source = Keypair.fromSecret(env.STELLAR_SOURCE_SECRET).publicKey();
  const account = await server.getAccount(source);
  const v = vk();
  const { proof, publicSignals } = pkg;

  const args = [
    scBytes(g1(v.vk_alpha_1)),
    scBytes(g2(v.vk_beta_2)),
    scBytes(g2(v.vk_gamma_2)),
    scBytes(g2(v.vk_delta_2)),
    scVecBytes(v.IC.map((p) => g1(p))),
    scBytes(negG1(proof.pi_a)),
    scBytes(g2(proof.pi_b)),
    scBytes(g1(proof.pi_c)),
    scVecBytes(publicSignals.map((s) => frBE(s))),
  ];

  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(env.ZK_CONTRACT_ID).call("verify", ...args))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Groth16 verifier simulation failed: ${sim.error.split("\n")[0]}`);
  return scValToNative((sim as { result: { retval: unknown } }).result.retval as Parameters<typeof scValToNative>[0]) === true;
}

/** A random scalar in [1, r). */
export function randomScalar(): bigint {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return (BigInt("0x" + randomBytes(32).toString("hex")) % (FR - 1n)) + 1n;
}

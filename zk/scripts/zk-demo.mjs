// Live, end-to-end ZK demo: generate a REAL Groth16 proof and verify it on the
// Soroban testnet verifier — then show a tampered statement being rejected.
// Run: pnpm zk:demo   (needs ZK_SOURCE_SECRET = a funded testnet secret, or it
// falls back to STELLAR_SOURCE_SECRET from the environment).
import fs from "node:fs";
import crypto from "node:crypto";
import { groth16 } from "snarkjs";
import {
  rpc, Contract, Keypair, TransactionBuilder, Networks, nativeToScVal, scValToNative, xdr,
} from "@stellar/stellar-sdk";

const FP = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const FR = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const deploy = JSON.parse(fs.readFileSync("zk/deploy.json", "utf8"));
const CONTRACT_ID = deploy.contractId;
const RPC = deploy.rpcUrl;
const vk = JSON.parse(fs.readFileSync("zk/artifacts/vk.json", "utf8"));
const SECRET = process.env.ZK_SOURCE_SECRET || process.env.STELLAR_SOURCE_SECRET;
if (!SECRET || !SECRET.startsWith("S")) throw new Error("Set ZK_SOURCE_SECRET to a funded testnet secret");

const feBE = (d) => Buffer.from(((BigInt(d) % FP + FP) % FP).toString(16).padStart(96, "0"), "hex");
const frBE = (d) => Buffer.from((BigInt(d) % FR).toString(16).padStart(64, "0"), "hex");
const g1 = (p) => Buffer.concat([feBE(p[0]), feBE(p[1])]);
const g2 = (p) => Buffer.concat([feBE(p[0][1]), feBE(p[0][0]), feBE(p[1][1]), feBE(p[1][0])]);
const negG1 = (p) => g1([p[0], ((FP - BigInt(p[1]) % FP) % FP).toString()]);
const sB = (b) => nativeToScVal(b, { type: "bytes" });
const sV = (a) => xdr.ScVal.scvVec(a.map(sB));

const server = new rpc.Server(RPC);
const account = await server.getAccount(Keypair.fromSecret(SECRET).publicKey());

async function onChainVerify(proof, publicSignals) {
  const args = [
    sB(g1(vk.vk_alpha_1)), sB(g2(vk.vk_beta_2)), sB(g2(vk.vk_gamma_2)), sB(g2(vk.vk_delta_2)),
    sV(vk.IC.map(g1)), sB(negG1(proof.pi_a)), sB(g2(proof.pi_b)), sB(g1(proof.pi_c)),
    sV(publicSignals.map(frBE)),
  ];
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(CONTRACT_ID).call("verify", ...args)).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return `ERROR: ${sim.error.split("\n")[0]}`;
  return scValToNative(sim.result.retval);
}

const rand = () => (BigInt("0x" + crypto.randomBytes(32).toString("hex")) % (FR - 1n)) + 1n;
const secret = rand(), blinding = rand();
const commitment = ((secret * secret % FR) + blinding % FR) % FR;

console.log("Trexure — live ZK proof verification on Stellar testnet");
console.log("  verifier contract:", CONTRACT_ID);
console.log("  statement: 'I know (secret, blinding) s.t. commitment = secret^2 + blinding'");
console.log("  public commitment:", commitment.toString());
console.log("  secret/blinding: <never revealed>\n");

console.log("Generating a real Groth16 proof (snarkjs, BLS12-381)…");
const { proof, publicSignals } = await groth16.fullProve(
  { secret: secret.toString(), blinding: blinding.toString(), commitment: commitment.toString() },
  "zk/artifacts/commit.wasm", "zk/artifacts/commit_final.zkey",
);
console.log("  off-chain snarkjs verify:", await groth16.verify(vk, publicSignals, proof));

console.log("\nVerifying the proof ON-CHAIN (Soroban testnet)…");
console.log("  → valid proof          :", await onChainVerify(proof, publicSignals));

const tampered = [(BigInt(publicSignals[0]) + 1n).toString()];
console.log("  → tampered commitment  :", await onChainVerify(proof, tampered), "(must be false)");
console.log("\nExplorer:", `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`);
process.exit(0);

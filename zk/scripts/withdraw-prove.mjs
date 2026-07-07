// End-to-end withdraw proof over the real artifacts (P2, #61): build a Merkle
// tree with lib/pool/mimc.ts, prove membership + nullifier, verify (positive),
// and check a tampered public signal fails (negative). Also writes a proof
// fixture (zk/artifacts/withdraw_proof.json / _public.json) the vitest verifies.
// Run: node zk/scripts/withdraw-prove.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as snarkjs from "snarkjs";
import { Keypair } from "@stellar/stellar-sdk";
import { hash2, commitmentHash, nullifierHash, toField } from "../../lib/pool/mimc.ts";
import { recipientToField } from "../../lib/pool/address.ts";

const here = dirname(fileURLToPath(import.meta.url));
const LEVELS = 4;
const wasm = resolve(here, "../artifacts/withdraw.wasm");
const zkey = resolve(here, "../artifacts/withdraw_final.zkey");
const vk = JSON.parse(readFileSync(resolve(here, "../artifacts/withdraw_vk.json"), "utf8"));
const dec = (b) => toField(b).toString(10);

// Empty incremental tree: zeros[i] is the hash of an all-zero subtree of height i.
const zeros = [0n];
for (let i = 1; i < LEVELS; i++) zeros.push(hash2(zeros[i - 1], zeros[i - 1]));

// One deposit note at leaf index 0; every sibling is a zero subtree.
const secret = 111111n;
const nullifier = 222222n;
const amount = 1234560000n; // stroops (arbitrary)
const commitment = commitmentHash(secret, nullifier, amount);

const pathElements = zeros.slice(0, LEVELS);
const pathIndices = new Array(LEVELS).fill(0);
let root = commitment;
for (let i = 0; i < LEVELS; i++) root = hash2(root, zeros[i]); // leaf is left child at every level

const recipient = recipientToField(Keypair.random().publicKey());
const nh = nullifierHash(nullifier);

const input = {
  root: dec(root),
  nullifierHash: dec(nh),
  recipient: dec(recipient),
  amount: dec(amount),
  secret: dec(secret),
  nullifier: dec(nullifier),
  pathElements: pathElements.map(dec),
  pathIndices,
};

console.log("proving (depth", LEVELS + ")…");
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
// public signal order = [root, nullifierHash, recipient, amount]
console.log("publicSignals:", publicSignals.map((s) => s.slice(0, 10) + "…"));

const okPositive = await snarkjs.groth16.verify(vk, publicSignals, proof);
console.log(okPositive ? "OK  positive: proof verifies" : "FAIL positive: proof rejected");

// Negative 1: tamper the recipient public signal → must fail.
const tampered = [...publicSignals];
tampered[2] = (BigInt(tampered[2]) + 1n).toString();
const okTamper = await snarkjs.groth16.verify(vk, tampered, proof);
console.log(!okTamper ? "OK  negative: tampered recipient rejected" : "FAIL negative: tampered recipient accepted");

// Negative 2: wrong nullifierHash input → witness generation must throw.
let okBadWitness = false;
try {
  await snarkjs.groth16.fullProve({ ...input, nullifierHash: dec(nh + 1n) }, wasm, zkey);
} catch {
  okBadWitness = true;
}
console.log(okBadWitness ? "OK  negative: wrong nullifierHash fails to prove" : "FAIL negative: wrong nullifierHash proved");

// Persist a fixture for the (fast, zkey-free) vitest verify.
writeFileSync(resolve(here, "../artifacts/withdraw_proof.json"), JSON.stringify(proof, null, 2) + "\n");
writeFileSync(resolve(here, "../artifacts/withdraw_public.json"), JSON.stringify(publicSignals, null, 2) + "\n");
console.log("wrote proof + public fixtures to zk/artifacts/");

if (!(okPositive && !okTamper && okBadWitness)) {
  console.error("\nFAILED");
  process.exit(1);
}
console.log("\nALL PASS — withdraw circuit proves, verifies, and rejects tampering");

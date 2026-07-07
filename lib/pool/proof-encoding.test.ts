import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import { groth16 } from "snarkjs";

import { encodeWithdrawProof } from "./proof-encoding";

const ZK = path.join(process.cwd(), "zk", "artifacts");
const proof = JSON.parse(readFileSync(path.join(ZK, "withdraw_proof.json"), "utf8"));
const publicSignals: string[] = JSON.parse(readFileSync(path.join(ZK, "withdraw_public.json"), "utf8"));
const vk = JSON.parse(readFileSync(path.join(ZK, "withdraw_vk.json"), "utf8"));

// Extract a `pub const NAME: [u8; N] = [0x.., ..];` byte array from the Rust
// fixture the P3 contract test verifies — the ground truth for Soroban encoding.
function fixtureBytes(name: string): Buffer {
  const src = readFileSync(path.join(process.cwd(), "zk", "verifier", "src", "withdraw_fixture.rs"), "utf8");
  const m = src.match(new RegExp(`pub const ${name}: \\[u8; \\d+\\] = \\[([^\\]]*)\\];`));
  if (!m) throw new Error(`fixture const ${name} not found`);
  return Buffer.from(m[1]!.split(",").map((s) => parseInt(s.trim(), 16)));
}

describe("pool proof-encoding (P4, #63)", () => {
  it("the committed withdraw proof verifies off-chain against withdraw_vk.json", async () => {
    expect(await groth16.verify(vk, publicSignals, proof)).toBe(true);
  });

  it("encodes the proof to the exact Soroban bytes the P3 contract expects", () => {
    const enc = encodeWithdrawProof(proof, publicSignals);
    expect(enc.negA).toEqual(fixtureBytes("PROOF_NEG_A")); // 96B, A with negated y
    expect(enc.b).toEqual(fixtureBytes("PROOF_B")); // 192B, Fp2 c1-first
    expect(enc.c).toEqual(fixtureBytes("PROOF_C")); // 96B
    expect(enc.root).toEqual(fixtureBytes("PUB_ROOT")); // 32B
    expect(enc.nullifierHash).toEqual(fixtureBytes("PUB_NULLIFIER"));
    expect(enc.recipientField).toEqual(fixtureBytes("PUB_RECIPIENT"));
  });

  it("carries the amount public signal as an i128-compatible bigint", () => {
    const enc = encodeWithdrawProof(proof, publicSignals);
    expect(enc.amount).toBe(BigInt(publicSignals[3]!));
  });

  it("produces fixed-width big-endian field encodings", () => {
    const enc = encodeWithdrawProof(proof, publicSignals);
    expect(enc.negA.length).toBe(96);
    expect(enc.b.length).toBe(192);
    expect(enc.c.length).toBe(96);
    expect(enc.root.length).toBe(32);
  });
});

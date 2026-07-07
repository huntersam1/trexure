import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import * as snarkjs from "snarkjs";
import { StrKey } from "@stellar/stellar-sdk";
import { FR } from "../lib/zk/commit";
import { recipientToField } from "../lib/pool/address";

const A = new URL("./artifacts/", import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, A), "utf8"));

const vk = load("withdraw_vk.json");
const proof = load("withdraw_proof.json");
const publicSignals: string[] = load("withdraw_public.json");
const golden = load("mimc-golden.json");

describe("withdraw circuit artifacts (P2)", () => {
  it("verifying key has the expected shape", () => {
    expect(vk.protocol).toBe("groth16");
    expect(vk.curve).toBe("bls12381");
    expect(vk.nPublic).toBe(4); // [root, nullifierHash, recipient, amount]
  });

  it("verifies the committed proof fixture (positive)", async () => {
    expect(await snarkjs.groth16.verify(vk, publicSignals, proof)).toBe(true);
  });

  it("rejects a tampered recipient public signal (negative)", async () => {
    const tampered = [...publicSignals];
    tampered[2] = (BigInt(tampered[2]!) + 1n).toString(); // recipient is signal index 2
    expect(await snarkjs.groth16.verify(vk, tampered, proof)).toBe(false);
  });

  it("circom round constants are transcribed byte-identically from P1 golden", () => {
    const circom = readFileSync(new URL("./circuits/mimc_constants.circom", import.meta.url), "utf8");
    const arr = circom.slice(circom.indexOf("return ["), circom.indexOf("];"));
    const nums = (arr.match(/\d+/g) ?? []).map((s) => BigInt(s));
    const goldenDec = golden.roundConstantsHex.map((h: string) => BigInt(h));
    expect(nums).toHaveLength(goldenDec.length);
    for (let i = 0; i < goldenDec.length; i++) expect(nums[i]).toBe(goldenDec[i]);
  });

  it("recipientToField is deterministic and in-field", () => {
    const g = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
    const a = recipientToField(g);
    expect(a).toBe(recipientToField(g));
    expect(a).toBeLessThan(FR);
  });
});

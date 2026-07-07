import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { FR } from "../zk/commit";
import {
  MIMC_EXPONENT,
  MIMC_ROUNDS,
  MIMC_CONSTANTS,
  hash2,
  commitmentHash,
  nullifierHash,
  toField,
  toHex32,
} from "./mimc";

type Golden = {
  params: { exponent: number; rounds: number; fieldOrderHex: string };
  roundConstantsHex: string[];
  vectors: {
    hash2: { in: [string, string]; out: string }[];
    commitment: { in: [string, string, string]; out: string }[];
    nullifierHash: { in: string; out: string }[];
  };
};

const golden: Golden = JSON.parse(
  readFileSync(new URL("../../zk/artifacts/mimc-golden.json", import.meta.url), "utf8"),
);

const toBig = (h: string): bigint => BigInt(h);

describe("MiMC reference (BLS12-381 Fr)", () => {
  it("uses a valid permutation exponent (gcd(d, r-1) === 1)", () => {
    const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
    expect(gcd(MIMC_EXPONENT, FR - 1n)).toBe(1n);
  });

  it("pins the golden-file parameters", () => {
    expect(golden.params.exponent).toBe(Number(MIMC_EXPONENT));
    expect(golden.params.rounds).toBe(MIMC_ROUNDS);
    expect(BigInt(golden.params.fieldOrderHex)).toBe(FR);
  });

  it("round constants: correct count, endpoints zero, match golden file", () => {
    expect(MIMC_CONSTANTS).toHaveLength(MIMC_ROUNDS);
    expect(MIMC_CONSTANTS[0]).toBe(0n);
    expect(MIMC_CONSTANTS[MIMC_ROUNDS - 1]).toBe(0n);
    expect(golden.roundConstantsHex).toHaveLength(MIMC_ROUNDS);
    for (let i = 0; i < MIMC_ROUNDS; i++) {
      expect(toHex32(MIMC_CONSTANTS[i]!)).toBe(golden.roundConstantsHex[i]);
    }
  });

  it("reproduces every hash2 golden vector", () => {
    for (const v of golden.vectors.hash2) {
      expect(toHex32(hash2(toBig(v.in[0]), toBig(v.in[1])))).toBe(v.out);
    }
  });

  it("reproduces every commitment golden vector", () => {
    for (const v of golden.vectors.commitment) {
      expect(toHex32(commitmentHash(toBig(v.in[0]), toBig(v.in[1]), toBig(v.in[2])))).toBe(v.out);
    }
  });

  it("reproduces every nullifierHash golden vector", () => {
    for (const v of golden.vectors.nullifierHash) {
      expect(toHex32(nullifierHash(toBig(v.in)))).toBe(v.out);
    }
  });

  it("all outputs are canonical field elements (< r)", () => {
    for (const v of [...golden.vectors.hash2, ...golden.vectors.commitment]) {
      expect(toBig(v.out)).toBeLessThan(FR);
    }
    for (const v of golden.vectors.nullifierHash) expect(toBig(v.out)).toBeLessThan(FR);
  });

  it("is deterministic and order-sensitive", () => {
    expect(hash2(1n, 2n)).toBe(hash2(1n, 2n));
    expect(hash2(1n, 2n)).not.toBe(hash2(2n, 1n));
  });

  it("domain-separates the three hash uses (arity)", () => {
    // Same numeric inputs through different functions must not collide.
    expect(commitmentHash(1n, 2n, 0n)).not.toBe(hash2(1n, 2n));
    expect(nullifierHash(1n)).not.toBe(hash2(1n, 0n));
  });

  it("toField normalizes negatives and out-of-range values", () => {
    expect(toField(-1n)).toBe(FR - 1n);
    expect(toField(FR + 5n)).toBe(5n);
  });
});

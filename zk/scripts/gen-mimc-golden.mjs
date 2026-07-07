// Regenerates zk/artifacts/mimc-golden.json — the cross-language spec for MiMC
// (issue #60). Run: `node zk/scripts/gen-mimc-golden.mjs` (via tsx for the .ts import).
// The circom circuit (P2) and Soroban contract (P3) must reproduce these exactly.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { FR } from "../../lib/zk/commit.ts";
import {
  MIMC_EXPONENT,
  MIMC_ROUNDS,
  MIMC_SEED,
  MIMC_CONSTANTS,
  hash2,
  commitmentHash,
  nullifierHash,
  toHex32,
} from "../../lib/pool/mimc.ts";

const hx = (b) => toHex32(b);

// Fixed sample inputs (arbitrary but pinned) for each hash function.
const hash2Cases = [
  [0n, 0n],
  [1n, 2n],
  [2n, 1n], // order-sensitive: must differ from [1,2]
  [123456789n, 987654321n],
  [0xdeadbeefn, 0xfeedfacen],
];
const commitCases = [
  [1n, 2n, 3n],
  [111n, 222n, 1000000n],
  [0n, 0n, 0n],
  [42n, 99n, 250000000n],
  [0xabcn, 0xdefn, 123n],
];
const nullCases = [0n, 1n, 42n, 987654321n, 0xdeadbeefn];

const golden = {
  _comment:
    "Cross-language MiMC spec for the Trexure shielded pool (issue #60). circom (P2) + Soroban (P3) MUST reproduce every vector. Regenerate with zk/scripts/gen-mimc-golden.mjs.",
  params: {
    field: "BLS12-381 Fr",
    fieldOrderHex: "0x" + FR.toString(16),
    exponent: Number(MIMC_EXPONENT),
    rounds: MIMC_ROUNDS,
    seed: MIMC_SEED,
    construction: "circomlib MiMCSponge (Feistel, x^5)",
  },
  roundConstantsHex: MIMC_CONSTANTS.map((c) => hx(c)),
  vectors: {
    hash2: hash2Cases.map(([a, b]) => ({ in: [hx(a), hx(b)], out: hx(hash2(a, b)) })),
    commitment: commitCases.map(([s, n, a]) => ({
      in: [hx(s), hx(n), hx(a)],
      out: hx(commitmentHash(s, n, a)),
    })),
    nullifierHash: nullCases.map((n) => ({ in: hx(n), out: hx(nullifierHash(n)) })),
  },
};

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../artifacts/mimc-golden.json");
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log("wrote", out, "-", golden.roundConstantsHex.length, "constants");

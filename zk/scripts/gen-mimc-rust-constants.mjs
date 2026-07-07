// Emits zk/verifier/src/mimc_constants.rs from the P1 golden file so the on-chain
// MiMC constants are provably identical to lib/pool/mimc.ts (#60) and the circuit
// (#61). Run: node zk/scripts/gen-mimc-rust-constants.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(here, "../artifacts/mimc-golden.json"), "utf8"));

// Each constant -> 32-byte big-endian array literal.
const toBytes = (hex) => {
  const h = BigInt(hex).toString(16).padStart(64, "0");
  const parts = [];
  for (let i = 0; i < 64; i += 2) parts.push("0x" + h.slice(i, i + 2));
  return `    [${parts.join(", ")}]`;
};

const body = `// AUTO-GENERATED from zk/artifacts/mimc-golden.json (P1, #60) by
// zk/scripts/gen-mimc-rust-constants.mjs. DO NOT EDIT BY HAND — these ${golden.roundConstantsHex.length}
// MiMC round constants (32-byte big-endian Fr) MUST stay byte-identical to
// lib/pool/mimc.ts and zk/circuits/mimc_constants.circom.

pub const MIMC_ROUNDS: usize = ${golden.params.rounds};

pub const MIMC_C: [[u8; 32]; ${golden.roundConstantsHex.length}] = [
${golden.roundConstantsHex.map(toBytes).join(",\n")}
];
`;

const out = resolve(here, "../verifier/src/mimc_constants.rs");
writeFileSync(out, body);
console.log("wrote", out, "-", golden.roundConstantsHex.length, "constants");

// Also print the golden vectors I'll hardcode into the Rust test.
const pick = {
  hash2: golden.vectors.hash2[1], // in [1,2]
  commitment: golden.vectors.commitment[0], // in [1,2,3]
  nullifier: golden.vectors.nullifierHash[2], // in 42
};
console.log("TEST_VECTORS", JSON.stringify(pick));

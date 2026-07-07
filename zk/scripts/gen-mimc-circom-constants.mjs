// Emits zk/circuits/mimc_constants.circom from the P1 golden file so the
// in-circuit MiMC constants are provably identical to lib/pool/mimc.ts (#60).
// Run: node zk/scripts/gen-mimc-circom-constants.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(here, "../artifacts/mimc-golden.json"), "utf8"));
const decs = golden.roundConstantsHex.map((h) => BigInt(h).toString(10));

const body = `pragma circom 2.1.0;

// AUTO-GENERATED from zk/artifacts/mimc-golden.json (P1, #60) by
// zk/scripts/gen-mimc-circom-constants.mjs. DO NOT EDIT BY HAND — the ${decs.length}
// MiMC round constants MUST stay byte-identical to lib/pool/mimc.ts, or on-chain
// proofs won't verify. exponent=${golden.params.exponent}, rounds=${golden.params.rounds}.

function mimcConstants() {
    return [
${decs.map((d) => "        " + d).join(",\n")}
    ];
}
`;

const out = resolve(here, "../circuits/mimc_constants.circom");
writeFileSync(out, body);
console.log("wrote", out, "-", decs.length, "constants");

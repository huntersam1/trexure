// Proves the in-circuit MiMC (mimc_check.circom) reproduces the P1 golden
// vectors exactly. Computes a witness for golden inputs and compares the
// circuit's output signals to zk/artifacts/mimc-golden.json.
// Run (after compiling mimc_check): node zk/scripts/mimc-circuit-crosscheck.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as snarkjs from "snarkjs";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(here, "../artifacts/mimc-golden.json"), "utf8"));
const wasm = resolve(here, "../build/mimc_check_js/mimc_check.wasm");

const toDec = (hex) => BigInt(hex).toString(10);
const out32 = (big) => "0x" + BigInt(big).toString(16).padStart(64, "0");

// Pick one golden case for each hash (index 1 = non-trivial inputs).
const h2 = golden.vectors.hash2[1]; // in:[a,b]
const cm = golden.vectors.commitment[0]; // in:[secret,nullifier,amount]
const nl = golden.vectors.nullifierHash[2]; // in: nullifier

const input = {
  a: toDec(h2.in[0]),
  b: toDec(h2.in[1]),
  secret: toDec(cm.in[0]),
  nullifier: toDec(cm.in[1]),
  amount: toDec(cm.in[2]),
};

// Note: the commitment case and nullifier case use different `nullifier` inputs;
// verify each hash with its own dedicated witness to compare apples-to-apples.
const wtnsPath = resolve(here, "../build/mimc_check.wtns");
async function witnessOutputs(inp) {
  await snarkjs.wtns.calculate(inp, wasm, wtnsPath);
  const w = await snarkjs.wtns.exportJson(wtnsPath);
  // outputs are witness[1..3]: hash2out, commitment, nullifierHashOut
  return { hash2out: w[1], commitment: w[2], nullifierHashOut: w[3] };
}

let failures = 0;
const check = (label, got, want) => {
  const g = out32(got);
  const ok = g === want;
  console.log(`${ok ? "OK " : "FAIL"} ${label}: circuit=${g.slice(0, 20)}… golden=${want.slice(0, 20)}…`);
  if (!ok) failures++;
};

// hash2
{
  const o = await witnessOutputs({ a: input.a, b: input.b, secret: 0, nullifier: 0, amount: 0 });
  check(`hash2(${h2.in[0].slice(0, 8)}…, ${h2.in[1].slice(0, 8)}…)`, o.hash2out, h2.out);
}
// commitment
{
  const o = await witnessOutputs({ a: 0, b: 0, secret: cm.in[0], nullifier: cm.in[1], amount: cm.in[2] });
  check("commitment(secret,nullifier,amount)", o.commitment, cm.out);
}
// nullifierHash
{
  const o = await witnessOutputs({ a: 0, b: 0, secret: 0, nullifier: toDec(nl.in), amount: 0 });
  check("nullifierHash(nullifier)", o.nullifierHashOut, nl.out);
}

if (failures) {
  console.error(`\n${failures} mismatch(es) — in-circuit MiMC != P1 golden vectors`);
  process.exit(1);
}
console.log("\nALL MATCH — in-circuit MiMC == P1 golden vectors (lib/pool/mimc.ts)");

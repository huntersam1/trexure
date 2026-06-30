// Brute-force the snarkjs -> Soroban BLS12-381 byte encoding by simulating the
// deployed Groth16 verifier against a known-good proof. Prints which combo verifies.
import fs from "node:fs";
import {
  rpc, Contract, Keypair, TransactionBuilder, Networks, nativeToScVal, scValToNative, xdr,
} from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = fs.readFileSync("/tmp/zk_contract_id.txt", "utf8").trim();
const SOURCE_SECRET = process.env.ZK_SOURCE_SECRET;

const P = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn; // BLS12-381 Fp

const dir = "zk/build";
const vk = JSON.parse(fs.readFileSync(`${dir}/vk.json`, "utf8"));
const proof = JSON.parse(fs.readFileSync(`${dir}/proof.json`, "utf8"));
const pub = JSON.parse(fs.readFileSync(`${dir}/public.json`, "utf8"));

function feBytes(decStr, endian, width = 48) {
  let v = BigInt(decStr) % P;
  if (v < 0n) v += P;
  let hex = v.toString(16).padStart(width * 2, "0");
  let buf = Buffer.from(hex, "hex");
  if (endian === "LE") buf = Buffer.from(buf).reverse();
  return buf;
}
function frBytes(decStr, endian) {
  let v = BigInt(decStr);
  let hex = v.toString(16).padStart(64, "0");
  let buf = Buffer.from(hex, "hex");
  if (endian === "LE") buf = Buffer.from(buf).reverse();
  return buf;
}
const g1 = (p, endian) => Buffer.concat([feBytes(p[0], endian), feBytes(p[1], endian)]);
function g2(p, endian, order) {
  // p = [[x_c0, x_c1], [y_c0, y_c1], ...]
  const x = order === "c0c1" ? [p[0][0], p[0][1]] : [p[0][1], p[0][0]];
  const y = order === "c0c1" ? [p[1][0], p[1][1]] : [p[1][1], p[1][0]];
  return Buffer.concat([feBytes(x[0], endian), feBytes(x[1], endian), feBytes(y[0], endian), feBytes(y[1], endian)]);
}
const negG1 = (p, endian) => {
  const negY = (P - (BigInt(p[1]) % P)) % P;
  return g1([p[0], negY.toString()], endian);
};
const scBytes = (b) => nativeToScVal(b, { type: "bytes" });
const scVecBytes = (arr) => xdr.ScVal.scvVec(arr.map(scBytes));

async function trySim(server, account, endian, order) {
  const c = new Contract(CONTRACT_ID);
  const args = [
    scBytes(g1(vk.vk_alpha_1, endian)),
    scBytes(g2(vk.vk_beta_2, endian, order)),
    scBytes(g2(vk.vk_gamma_2, endian, order)),
    scBytes(g2(vk.vk_delta_2, endian, order)),
    scVecBytes(vk.IC.map((p) => g1(p, endian))),
    scBytes(negG1(proof.pi_a, endian)),
    scBytes(g2(proof.pi_b, endian, order)),
    scBytes(g1(proof.pi_c, endian)),
    scVecBytes(pub.map((s) => frBytes(s, endian))),
  ];
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(c.call("verify", ...args)).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return `ERR(${sim.error.split("\n")[0].slice(0, 60)})`;
  return scValToNative(sim.result.retval);
}

const server = new rpc.Server(RPC);
const account = await server.getAccount(Keypair.fromSecret(SOURCE_SECRET).publicKey());
for (const endian of ["BE", "LE"]) {
  for (const order of ["c0c1", "c1c0"]) {
    try {
      const r = await trySim(server, account, endian, order);
      console.log(`endian=${endian} fp2=${order} -> ${r}`);
      if (r === true) { console.log(`\n✅ WORKING ENCODING: endian=${endian} fp2order=${order}`); process.exit(0); }
    } catch (e) { console.log(`endian=${endian} fp2=${order} -> threw ${String(e).slice(0, 80)}`); }
  }
}

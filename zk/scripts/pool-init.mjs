// One-time initialize for a deployed ShieldedPool (P5, #64): sets the custody
// token (native XLM SAC), tree depth (4, per #74), and the withdraw verifying
// key (P2). The vk is a Soroban struct, so we build the ScVal by hand in the
// locked encoding (BE, Fp2 c1-first). Idempotent-safe: a second run reverts
// (AlreadyInitialized). Usage:
//   POOL_CONTRACT_ID=C... STELLAR_SOURCE_SECRET=S... node zk/scripts/pool-init.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  rpc, Contract, Keypair, TransactionBuilder, Networks, Address, BASE_FEE, xdr,
} from "@stellar/stellar-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const POOL = process.env.POOL_CONTRACT_ID;
const SECRET = process.env.STELLAR_SOURCE_SECRET;
const DEPTH = Number(process.env.POOL_DEPTH || "4");
// Native XLM Stellar Asset Contract (testnet).
const NATIVE_SAC = process.env.POOL_TOKEN_SAC || "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
if (!POOL || !SECRET) throw new Error("set POOL_CONTRACT_ID and STELLAR_SOURCE_SECRET");

const P = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const feBE = (d) => Buffer.from((((BigInt(d) % P) + P) % P).toString(16).padStart(96, "0"), "hex");
const g1 = (p) => Buffer.concat([feBE(p[0]), feBE(p[1])]); // 96
const g2 = (p) => Buffer.concat([feBE(p[0][1]), feBE(p[0][0]), feBE(p[1][1]), feBE(p[1][0])]); // 192, c1-first

const vk = JSON.parse(readFileSync(resolve(here, "../artifacts/withdraw_vk.json"), "utf8"));
const bytes = (b) => xdr.ScVal.scvBytes(b);
const entry = (k, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
// #[contracttype] struct → ScMap with symbol keys in lexicographic order.
const vkScVal = xdr.ScVal.scvMap([
  entry("alpha", bytes(g1(vk.vk_alpha_1))),
  entry("beta", bytes(g2(vk.vk_beta_2))),
  entry("delta", bytes(g2(vk.vk_delta_2))),
  entry("gamma", bytes(g2(vk.vk_gamma_2))),
  entry("ic", xdr.ScVal.scvVec(vk.IC.map((p) => bytes(g1(p))))),
]);

const server = new rpc.Server(RPC, { allowHttp: RPC.startsWith("http://") });
const kp = Keypair.fromSecret(SECRET);
const account = await server.getAccount(kp.publicKey());

const op = new Contract(POOL).call(
  "initialize",
  new Address(NATIVE_SAC).toScVal(),
  xdr.ScVal.scvU32(DEPTH),
  vkScVal,
);
let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(op).setTimeout(60).build();
tx = await server.prepareTransaction(tx);
tx.sign(kp);
const sent = await server.sendTransaction(tx);
if (sent.status === "ERROR") throw new Error("initialize submission ERROR: " + JSON.stringify(sent.errorResult ?? sent));
let ok = false;
for (let i = 0; i < 30; i++) {
  const got = await server.getTransaction(sent.hash);
  if (got.status === "SUCCESS") { ok = true; break; }
  if (got.status === "FAILED") throw new Error("initialize FAILED on-chain: " + sent.hash);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(JSON.stringify({ pool: POOL, token: NATIVE_SAC, depth: DEPTH, initTx: sent.hash, ok }, null, 2));

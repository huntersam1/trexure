import "dotenv/config";
// Shielded-pool testnet E2E (P5, #64): real deposit → withdraw on Soroban
// testnet, proving value moves AND the deposit↔withdrawal link is hidden.
// Mirrors zk-demo.mjs. Run: pnpm pool:demo
//   (needs a funded STELLAR_SOURCE_SECRET; POOL_CONTRACT_ID from zk/pool-deploy.json)
//
// Flow: fresh depositor A deposits N XLM into the pool and gets a secret note;
// the server relays a withdraw that pays a fresh recipient B using ONLY the note.
// A↔B are unlinkable on-chain — the withdraw tx never references the deposit.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  rpc, Contract, Keypair, TransactionBuilder, Networks, BASE_FEE, scValToNative, xdr,
} from "@stellar/stellar-sdk";

import { parseNote } from "../../lib/pool/note.ts";
import { submitDeposit } from "../../lib/pool/deposit.ts";
import { submitWithdraw } from "../../lib/pool/withdraw.ts";
import { PoolMerkleTree } from "../../lib/pool/tree.ts";

const here = dirname(fileURLToPath(import.meta.url));
const deploy = JSON.parse(readFileSync(resolve(here, "../pool-deploy.json"), "utf8"));
const RPC = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const POOL = process.env.POOL_CONTRACT_ID || deploy.poolContractId;
const RELAYER = process.env.STELLAR_SOURCE_SECRET;
const AMOUNT_XLM = BigInt(process.env.POOL_DEMO_XLM || "10");
const STROOP = 10_000_000n;
const AMOUNT = AMOUNT_XLM * STROOP;
if (!RELAYER) throw new Error("STELLAR_SOURCE_SECRET (funded relayer) required");

const server = new rpc.Server(RPC, { allowHttp: RPC.startsWith("http://") });
const relayerPub = Keypair.fromSecret(RELAYER).publicKey();
const XPL = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const log = (...a) => console.log(...a);

async function friendbot(pub) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(pub)}`);
  if (!r.ok) throw new Error(`friendbot ${r.status} for ${pub}`);
}
async function nativeBalance(pub) {
  const r = await fetch(`https://horizon-testnet.stellar.org/accounts/${pub}`);
  if (!r.ok) return 0n;
  const j = await r.json();
  const b = (j.balances || []).find((x) => x.asset_type === "native");
  return b ? BigInt(b.balance.replace(".", "")) : 0n; // Horizon always has 7 decimals -> stroops
}
async function readRoot() {
  const acct = await server.getAccount(relayerPub);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(POOL).call("get_root")).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error("get_root sim: " + sim.error.split("\n")[0]);
  return BigInt("0x" + Buffer.from(scValToNative(sim.result.retval)).toString("hex"));
}
// Sync every deposit leaf from the pool's `deposit` events since deployment,
// ordered by index — the whole tree, so the mirror matches on-chain regardless
// of how many prior deposits exist. (Production would persist a DB mirror; event
// sync is bounded by RPC retention.)
async function syncLeaves() {
  const latest = (await server.getLatestLedger()).sequence;
  const startLedger = Math.max(deploy.deployLedger, latest - 120000);
  const res = await server.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [POOL], topics: [[xdr.ScVal.scvSymbol("deposit").toXDR("base64")]] }],
  });
  const rows = (res.events || []).map((e) => {
    const [commitment, index] = scValToNative(e.value);
    return { index: Number(index), commitment: BigInt("0x" + Buffer.from(commitment).toString("hex")) };
  });
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.commitment);
}

log(`\n🌊 Shielded-pool testnet E2E — pool ${POOL}`);
log(`   depositing ${AMOUNT_XLM} XLM, depth ${deploy.depth}, token ${deploy.tokenAsset} (SAC ${deploy.tokenSac})\n`);

// 1. Fresh depositor A + recipient B.
const depositor = Keypair.random();
const recipient = Keypair.random();
log(`① funding fresh depositor A=${depositor.publicKey()} and recipient B=${recipient.publicKey()} …`);
await Promise.all([friendbot(depositor.publicKey()), friendbot(recipient.publicKey())]);
const bBefore = await nativeBalance(recipient.publicKey());

// 2. Deposit from A → note string.
log(`② A deposits ${AMOUNT_XLM} XLM into the pool …`);
const dep = await submitDeposit({ amount: AMOUNT, poolContractId: POOL, fromSecret: depositor.secret() });
log(`   ✔ deposit tx ${dep.txHash}`);
log(`   🎫 note: ${dep.noteString}`);
log(`   ${XPL(dep.txHash)}`);

// 3. Rebuild the tree from on-chain events; locate our leaf; verify root parity.
const depositCommitment = BigInt("0x" + dep.commitment.toString("hex"));
const leaves = await syncLeaves();
const tree = PoolMerkleTree.from(leaves);
const leafIndex = leaves.findIndex((c) => c === depositCommitment);
const onchainRoot = await readRoot();
if (leafIndex < 0) throw new Error("deposit commitment not found in synced leaves");
if (tree.root !== onchainRoot) throw new Error(`off-chain root ${tree.root} != on-chain root ${onchainRoot}`);
log(`③ off-chain tree root == on-chain root ✔ (leaf index ${leafIndex}, ${leaves.length} leaves)`);

// 4. Withdraw to B using only the note (server relays; B pays nothing).
log(`④ withdrawing to B using only the note …`);
const note = parseNote(dep.noteString);
const wd = await submitWithdraw({ note, recipientPublicKey: recipient.publicKey(), tree, leafIndex, poolContractId: POOL });
log(`   ✔ withdraw tx ${wd.txHash}`);
log(`   ${XPL(wd.txHash)}`);

// 5. Assert value moved.
const bAfter = await nativeBalance(recipient.publicKey());
const delta = bAfter - bBefore;
log(`⑤ recipient B balance +${delta} stroops (expected ${AMOUNT})`);
if (delta !== AMOUNT) throw new Error(`recipient delta ${delta} != deposited ${AMOUNT}`);

// 6. Double-withdraw with the same note must fail (nullifier spent).
log(`⑥ replaying the withdraw (double-spend) — must be rejected …`);
let doubleSpendRejected = false;
try {
  await submitWithdraw({ note, recipientPublicKey: recipient.publicKey(), tree, leafIndex, poolContractId: POOL });
} catch {
  doubleSpendRejected = true;
}
if (!doubleSpendRejected) throw new Error("double-spend was NOT rejected");
log(`   ✔ nullifier spent — second withdraw rejected`);

// 7. Unlinkability narrative.
log(`\n🔒 Unlinkability: the deposit tx is signed by A=${depositor.publicKey().slice(0, 8)}…, the withdraw is`);
log(`   relayed by the server and pays B=${recipient.publicKey().slice(0, 8)}…. The withdraw envelope never`);
log(`   references the deposit tx or A — only a ZK proof of membership + a fresh nullifier.`);
log(`   deposit:  ${XPL(dep.txHash)}`);
log(`   withdraw: ${XPL(wd.txHash)}`);
log(`\n✅ POOL DEMO PASSED — real XLM moved A→pool→B, unlinkable, double-spend blocked.\n`);
// snarkjs leaves worker/wasm handles that keep the event loop alive; exit cleanly
// so `pnpm pool:demo` terminates (headless CI-smoke). Errors above already exit 1.
process.exit(0);

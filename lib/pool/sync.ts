import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

import { env } from "@/lib/env";
import { PoolMerkleTree } from "./tree";

/**
 * Rebuild the pool's Merkle tree off-chain by syncing every `deposit` event
 * since the contract's deploy ledger (P6, #65 — server-side of P5's demo sync).
 * The tree must reproduce the on-chain root for the withdraw path to verify.
 * Event sync is bounded by RPC retention; a production mirror would persist
 * leaves to a DB.
 */

type PoolDeploy = { poolContractId: string; deployLedger: number };

let _deploy: PoolDeploy | null = null;
function poolDeploy(): PoolDeploy {
  return (_deploy ??= JSON.parse(
    readFileSync(path.join(process.cwd(), "zk", "pool-deploy.json"), "utf8"),
  ) as PoolDeploy);
}

/** The deployed pool contract id (env override wins over the recorded deploy). */
export function poolContractId(): string {
  return env.POOL_CONTRACT_ID || poolDeploy().poolContractId;
}

const server = (): rpc.Server =>
  new rpc.Server(env.STELLAR_RPC_URL, { allowHttp: env.STELLAR_RPC_URL.startsWith("http://") });

/** Ordered deposit commitments (by leaf index) currently in the pool. */
export async function syncPoolLeaves(): Promise<bigint[]> {
  const srv = server();
  const latest = (await srv.getLatestLedger()).sequence;
  // Clamp to the RPC retention window; the deploy is recent for the demo pool.
  const startLedger = Math.max(poolDeploy().deployLedger, latest - 120_000);
  const res = await srv.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [poolContractId()],
        topics: [[xdr.ScVal.scvSymbol("deposit").toXDR("base64")]],
      },
    ],
  });
  const rows = (res.events ?? []).map((e: { value: unknown }) => {
    const [commitment, index] = scValToNative(e.value as Parameters<typeof scValToNative>[0]) as [
      Uint8Array,
      number,
      Uint8Array,
    ];
    return { index: Number(index), commitment: BigInt("0x" + Buffer.from(commitment).toString("hex")) };
  });
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.commitment);
}

/** Build the off-chain Merkle mirror + return the ordered leaves. */
export async function syncPoolTree(): Promise<{ tree: PoolMerkleTree; leaves: bigint[] }> {
  const leaves = await syncPoolLeaves();
  return { tree: PoolMerkleTree.from(leaves), leaves };
}

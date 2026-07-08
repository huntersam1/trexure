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
  const filters = [
    {
      type: "contract" as const,
      contractIds: [poolContractId()],
      topics: [[xdr.ScVal.scvSymbol("deposit").toXDR("base64")]],
    },
  ];

  // The RPC bounds each getEvents scan to a fixed ledger window (~10k ledgers),
  // so a single call from startLedger stops short of `latest` once the pool has
  // been alive longer than that window — silently dropping recent deposits (and
  // breaking the withdraw path: the mirror root no longer matches on-chain). Page
  // forward by cursor until the scan reaches `latest`, collecting every event.
  type EventsReq = Parameters<typeof srv.getEvents>[0];
  const rows: { index: number; commitment: bigint }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const req = (cursor ? { filters, cursor, limit: 200 } : { startLedger, filters, limit: 200 }) as EventsReq;
    const res = await srv.getEvents(req);
    for (const e of res.events ?? []) {
      const [commitment, index] = scValToNative(
        (e as { value: unknown }).value as Parameters<typeof scValToNative>[0],
      ) as [Uint8Array, number, Uint8Array];
      rows.push({ index: Number(index), commitment: BigInt("0x" + Buffer.from(commitment).toString("hex")) });
    }
    cursor = (res as { cursor?: string }).cursor;
    if (!cursor) break;
    // The cursor's leading toid encodes the ledger scanned up to; stop at latest.
    const toid = cursor.split("-")[0] ?? "0";
    const scannedLedger = Number(BigInt(toid) >> 32n);
    if (scannedLedger >= latest) break;
  }

  // A deposit index is unique on-chain; dedup defensively in case a boundary
  // event repeats across pages, keeping leaves ordered by their tree index.
  const byIndex = new Map<number, bigint>();
  for (const r of rows) if (!byIndex.has(r.index)) byIndex.set(r.index, r.commitment);
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

/** Build the off-chain Merkle mirror + return the ordered leaves. */
export async function syncPoolTree(): Promise<{ tree: PoolMerkleTree; leaves: bigint[] }> {
  const leaves = await syncPoolLeaves();
  return { tree: PoolMerkleTree.from(leaves), leaves };
}

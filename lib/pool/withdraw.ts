import "server-only";

import path from "node:path";

import { groth16 } from "snarkjs";
import {
  rpc,
  Keypair,
  Contract,
  Address,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";

import { env } from "../env";
import { logger } from "../log";
import type { Groth16Proof } from "../zk/groth16";
import type { Note } from "./note";
import { PoolMerkleTree } from "./tree";
import { recipientToField } from "./address";
import { encodeWithdrawProof, type EncodedWithdraw } from "./proof-encoding";

const ZK_DIR = path.join(process.cwd(), "zk", "artifacts");
const WASM_PATH = path.join(ZK_DIR, "withdraw.wasm");
const ZKEY_PATH = path.join(ZK_DIR, "withdraw_final.zkey");

export type WithdrawProof = {
  proof: Groth16Proof;
  publicSignals: string[]; // [root, nullifierHash, recipient, amount]
  encoded: EncodedWithdraw;
  recipientField: bigint;
};

/**
 * Generate the Groth16 withdraw proof for `note` at `leafIndex` in the mirrored
 * tree, paying out to `recipientPublicKey`. Proves — in zero knowledge — that the
 * note's commitment is in the tree and its nullifier is fresh, without revealing
 * which deposit. Pure crypto (no network); `submitWithdraw` sends the result.
 */
export async function buildWithdrawProof(args: {
  note: Note;
  recipientPublicKey: string;
  tree: PoolMerkleTree;
  leafIndex: number;
}): Promise<WithdrawProof> {
  const { note, recipientPublicKey, tree, leafIndex } = args;
  const { pathElements, pathIndices } = tree.buildPath(leafIndex); // throws if not present
  const recipientField = recipientToField(recipientPublicKey);

  const input = {
    root: tree.root.toString(),
    nullifierHash: note.nullifierHash.toString(),
    recipient: recipientField.toString(),
    amount: note.amount.toString(),
    secret: note.secret.toString(),
    nullifier: note.nullifier.toString(),
    pathElements: pathElements.map((e) => e.toString()),
    pathIndices,
  };

  const { proof, publicSignals } = await groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
  return {
    proof: proof as Groth16Proof,
    publicSignals: publicSignals as string[],
    encoded: encodeWithdrawProof(proof as Groth16Proof, publicSignals as string[]),
    recipientField,
  };
}

/**
 * Build the proof and submit `ShieldedPool.withdraw`, paying `note.amount` to
 * `recipientPublicKey` from the pool — unlinkable to the deposit. The server
 * account (`STELLAR_SOURCE_SECRET`) signs + pays the fee (relayer model for the
 * demo). Returns the testnet tx hash. Requires a deployed `poolContractId`.
 */
export async function submitWithdraw(args: {
  note: Note;
  recipientPublicKey: string;
  tree: PoolMerkleTree;
  leafIndex: number;
  poolContractId: string;
}): Promise<{ txHash: string; ledger: number }> {
  const { poolContractId, recipientPublicKey } = args;
  const { encoded } = await buildWithdrawProof(args);

  const server = new rpc.Server(env.STELLAR_RPC_URL, {
    allowHttp: env.STELLAR_RPC_URL.startsWith("http://"),
  });
  const keypair = Keypair.fromSecret(env.STELLAR_SOURCE_SECRET);
  const account = await server.getAccount(keypair.publicKey());

  const bytes = (b: Buffer) => nativeToScVal(b, { type: "bytes" });
  const operation = new Contract(poolContractId).call(
    "withdraw",
    bytes(encoded.negA),
    bytes(encoded.b),
    bytes(encoded.c),
    bytes(encoded.root),
    bytes(encoded.nullifierHash),
    new Address(recipientPublicKey).toScVal(),
    bytes(encoded.recipientField),
    nativeToScVal(encoded.amount, { type: "i128" }),
  );

  let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  tx = await server.prepareTransaction(tx);
  tx.sign(keypair);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    logger.error({ poolContractId, status: sent.status }, "pool withdraw submission failed");
    throw new Error(`ShieldedPool.withdraw rejected (status=${sent.status})`);
  }

  let ledger = 0;
  for (let i = 0; i < 30; i++) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      ledger = got.ledger ?? 0;
      break;
    }
    if (got.status === "FAILED") throw new Error(`ShieldedPool.withdraw ${sent.hash} failed on-chain`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  logger.info({ poolContractId, txHash: sent.hash, ledger }, "pool withdraw submitted");
  return { txHash: sent.hash, ledger };
}

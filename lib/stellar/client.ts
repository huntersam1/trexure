import "server-only";

import {
  rpc,
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import { env } from "../env";
import { logger } from "../log";

const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Shared Soroban RPC server (testnet). */
const server = new rpc.Server(env.STELLAR_RPC_URL, {
  allowHttp: env.STELLAR_RPC_URL.startsWith("http://"),
});

const sourceKeypair = (): Keypair => Keypair.fromSecret(env.STELLAR_SOURCE_SECRET);

/**
 * Build, server-sign (STELLAR_SOURCE_SECRET) and submit a Soroban private-payment tx.
 * The intentId — the reconciliation join key — travels as the first contract-call
 * argument; the contract publishes an event (topics=(intentId,), data=commitment)
 * that watch-onchain confirms against. Soroban transactions reject classic memos,
 * so none is attached (#30).
 * Returns the testnet tx hash, settling ledger, and the ZK contract id used.
 */
export async function buildAndSubmitPrivatePayment(args: {
  intentId: string;
  amount: string;
  sourceAsset: string;
  /** The payment's proofHash — recorded on-chain as the event payload (#31). */
  commitment: string;
}): Promise<{ txHash: string; ledger: number; contractId: string }> {
  const contractId = env.ZK_CONTRACT_ID;
  const keypair = sourceKeypair();
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const operation = contract.call(
    "shielded_transfer",
    nativeToScVal(args.intentId, { type: "string" }),
    nativeToScVal(args.amount, { type: "string" }),
    nativeToScVal(args.sourceAsset, { type: "string" }),
    nativeToScVal(args.commitment, { type: "string" }),
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  // Soroban requires simulate/prepare before submit.
  tx = await server.prepareTransaction(tx);
  tx.sign(keypair);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    logger.error({ intentId: args.intentId, status: sent.status }, "stellar submission failed");
    throw new Error(`Soroban tx submission rejected (status=${sent.status})`);
  }

  const txHash = sent.hash;

  // Poll for inclusion.
  let ledger = 0;
  for (let i = 0; i < 30; i++) {
    const got = await server.getTransaction(txHash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      ledger = got.ledger ?? 0;
      break;
    }
    if (got.status === "FAILED") {
      logger.error({ txHash }, "stellar tx failed on-chain");
      throw new Error(`Soroban tx ${txHash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  logger.info({ intentId: args.intentId, txHash, ledger }, "stellar private payment submitted");
  return { txHash, ledger, contractId };
}

/**
 * Wrap Soroban RPC getEvents for a contract/topic from a starting ledger.
 * The topic filter is the intentId as an XDR-encoded ScVal string (the RPC
 * matches base64 ScVals, not raw text), and the event value decodes to the
 * commitment the contract recorded — mapped to the reconciliation shape
 * [{txHash, ledger, proofHash}].
 */
export async function getContractEvents(args: {
  contractId: string;
  topic: string;
  startLedger: number;
}): Promise<Array<{ txHash: string; ledger: number; proofHash: string }>> {
  const res = await server.getEvents({
    startLedger: args.startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [args.contractId],
        topics: [[nativeToScVal(args.topic, { type: "string" }).toXDR("base64")]],
      },
    ],
  });

  return (res.events ?? []).map((e: { txHash: string; ledger: number; value: unknown }) => {
    let proofHash: string;
    try {
      const decoded: unknown = scValToNative(e.value as Parameters<typeof scValToNative>[0]);
      proofHash = typeof decoded === "string" ? decoded : String(decoded);
    } catch {
      proofHash = typeof e.value === "string" ? e.value : String(e.value);
    }
    return { txHash: e.txHash, ledger: e.ledger, proofHash };
  });
}

/**
 * Testnet-only helper: fund an account via Friendbot so it can pay fees.
 * Used by the seed/dev bootstrap; not called on the request path.
 */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Friendbot funding failed (${res.status}): ${body}`);
  }
  logger.info({ publicKey }, "funded testnet account via friendbot");
}

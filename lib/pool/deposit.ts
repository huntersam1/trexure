import "server-only";

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
import { generateNote, serializeNote, type Note } from "./note";

/** 32-byte big-endian commitment (the pool's `BytesN<32>` deposit leaf). */
function commitmentBytes(note: Note): Buffer {
  return Buffer.from(note.commitment.toString(16).padStart(64, "0"), "hex");
}

export type PreparedDeposit = {
  note: Note;
  /** The bearer claim string — hand this to whoever will withdraw. */
  noteString: string;
  /** Commitment in the pool's on-chain `BytesN<32>` shape. */
  commitment: Buffer;
};

/**
 * Mint a fresh note for `amount` and derive its on-chain commitment (P4, #63).
 * Pure (no network) so it is unit-testable; `submitDeposit` sends the leaf +
 * SAC transfer. The returned `noteString` is the ONLY way to withdraw later —
 * losing it forfeits the deposit.
 */
export function prepareDeposit(amount: bigint): PreparedDeposit {
  const note = generateNote(amount);
  return { note, noteString: serializeNote(note), commitment: commitmentBytes(note) };
}

/**
 * Mint a note and submit `ShieldedPool.deposit(from, amount, commitment)` — the
 * SAC transfers `amount` of the pool token from `from` into custody and the
 * commitment is inserted into the on-chain tree. The server account
 * (`STELLAR_SOURCE_SECRET`) signs + pays the fee and is the `from` for the demo.
 * Returns the note string (claim credential) + deposit tx hash.
 */
export async function submitDeposit(args: {
  amount: bigint;
  poolContractId: string;
  /** Depositor secret (signs + funds the deposit). Defaults to the server key. */
  fromSecret?: string;
}): Promise<{ noteString: string; commitment: Buffer; txHash: string; ledger: number }> {
  const { amount, poolContractId } = args;
  const { noteString, commitment } = prepareDeposit(amount);

  const server = new rpc.Server(env.STELLAR_RPC_URL, {
    allowHttp: env.STELLAR_RPC_URL.startsWith("http://"),
  });
  const keypair = Keypair.fromSecret(args.fromSecret ?? env.STELLAR_SOURCE_SECRET);
  const from = keypair.publicKey();
  const account = await server.getAccount(from);

  const operation = new Contract(poolContractId).call(
    "deposit",
    new Address(from).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(commitment, { type: "bytes" }),
  );

  let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  tx = await server.prepareTransaction(tx); // authorizes the SAC transfer via sim
  tx.sign(keypair);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    logger.error({ poolContractId, status: sent.status }, "pool deposit submission failed");
    throw new Error(`ShieldedPool.deposit rejected (status=${sent.status})`);
  }

  let ledger = 0;
  for (let i = 0; i < 30; i++) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      ledger = got.ledger ?? 0;
      break;
    }
    if (got.status === "FAILED") throw new Error(`ShieldedPool.deposit ${sent.hash} failed on-chain`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  logger.info({ poolContractId, txHash: sent.hash, ledger }, "pool deposit submitted");
  return { noteString, commitment, txHash: sent.hash, ledger };
}

import "server-only";

import { AppError } from "@/lib/http/problem";
import type { PoolDepositInput, PoolWithdrawInput } from "@/lib/validation/pool";
import { submitDeposit } from "./deposit";
import { submitWithdraw } from "./withdraw";
import { parseNote } from "./note";
import { poolContractId, syncPoolTree } from "./sync";

/**
 * Service layer for the shielded-pool rail (P6, #65). Thin glue over the P4 lib
 * (deposit/withdraw) + P5 sync; server-signed for the demo. Routes stay thin and
 * delegate here (mirrors lib/payments/service.ts).
 */

const STROOP = 10_000_000n;
const explorerUrl = (txHash: string) => `https://stellar.expert/explorer/testnet/tx/${txHash}`;

export type PoolDepositResult = {
  note: string;
  commitment: string;
  amount: number;
  txHash: string;
  ledger: number;
  explorerUrl: string;
};

/** Shield `amount` XLM into the pool; returns the one-time claim note + tx. */
export async function createPoolDeposit(input: PoolDepositInput): Promise<PoolDepositResult> {
  const amountStroops = BigInt(Math.round(input.amount * Number(STROOP)));
  const res = await submitDeposit({ amount: amountStroops, poolContractId: poolContractId() });
  return {
    note: res.noteString,
    commitment: "0x" + res.commitment.toString("hex"),
    amount: input.amount,
    txHash: res.txHash,
    ledger: res.ledger,
    explorerUrl: explorerUrl(res.txHash),
  };
}

export type PoolWithdrawResult = { txHash: string; ledger: number; explorerUrl: string };

/** Claim a note: prove membership + pay `recipient` from the pool. */
export async function createPoolWithdraw(input: PoolWithdrawInput): Promise<PoolWithdrawResult> {
  let note;
  try {
    note = parseNote(input.note);
  } catch {
    throw new AppError(422, "Invalid note", "The note is malformed or not a trexure pool note");
  }

  const { tree, leaves } = await syncPoolTree();
  const leafIndex = leaves.findIndex((c) => c === note.commitment);
  if (leafIndex < 0) {
    throw new AppError(422, "Unknown note", "This note's deposit is not in the pool (already claimed or wrong pool)");
  }

  const res = await submitWithdraw({
    note,
    recipientPublicKey: input.recipient,
    tree,
    leafIndex,
    poolContractId: poolContractId(),
  });
  return { txHash: res.txHash, ledger: res.ledger, explorerUrl: explorerUrl(res.txHash) };
}

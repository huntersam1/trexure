import "server-only";

import { Keypair } from "@stellar/stellar-sdk";

import { Prisma } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/problem";
import type { PoolDepositInput, PoolWithdrawInput } from "@/lib/validation/pool";
import { submitDeposit } from "./deposit";
import { submitWithdraw } from "./withdraw";
import { parseNote } from "./note";
import { poolContractId, syncPoolTree } from "./sync";

/**
 * The server/relayer account that custodies pool withdrawals for the bank claim
 * path (P5, #87) — the same account that signs pool txs. Derived lazily so a
 * placeholder secret in a mocked test never forces a strkey decode.
 */
export function custodyAddress(): string {
  return Keypair.fromSecret(env.STELLAR_SOURCE_SECRET).publicKey();
}

/**
 * Service layer for the shielded-pool rail (P6, #65). Thin glue over the P4 lib
 * (deposit/withdraw) + P5 sync; server-signed for the demo. Routes stay thin and
 * delegate here (mirrors lib/payments/service.ts).
 */

const STROOP = 10_000_000n;
const explorerUrl = (txHash: string) => `https://stellar.expert/explorer/testnet/tx/${txHash}`;

/**
 * Convert a decimal-string XLM amount to whole stroops WITHOUT touching a JS
 * float (#143 H2). `amount * 1e7` in `number` silently loses precision above
 * ~9e8 XLM (2^53 stroops); Prisma.Decimal is exact. Throws on a non-finite,
 * non-positive, or sub-stroop-precision (> 7 dp) amount rather than rounding
 * money away.
 */
export function xlmToStroops(amount: string): bigint {
  const d = new Prisma.Decimal(amount);
  if (!d.isFinite() || d.lte(0)) throw new Error(`invalid XLM amount: ${amount}`);
  const stroops = d.mul(STROOP.toString());
  if (!stroops.isInteger()) throw new Error(`XLM amount exceeds stroop precision (7 dp): ${amount}`);
  return BigInt(stroops.toFixed(0));
}

export type PoolDepositResult = {
  note: string;
  commitment: string;
  amount: string;
  txHash: string;
  ledger: number;
  explorerUrl: string;
};

/** Shield `amount` XLM into the pool; returns the one-time claim note + tx. */
export async function createPoolDeposit(input: PoolDepositInput): Promise<PoolDepositResult> {
  const amountStroops = xlmToStroops(input.amount);
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

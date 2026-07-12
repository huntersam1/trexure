import "server-only";

import { Keypair } from "@stellar/stellar-sdk";

import { fundWithFriendbot } from "@/lib/stellar/client";
import { createPoolDeposit, createPoolWithdraw } from "./service";
import type { PoolDemoInput } from "@/lib/validation/pool";

/**
 * One-click pool demo (P6, #65 — the in-app analogue of `pnpm pool:demo` / P5):
 * shield `amount` XLM, then claim it to a FRESH testnet address using only the
 * note. The deposit and withdrawal are unlinkable on-chain. Server-signed; the
 * fresh recipient is funded via Friendbot so the native transfer lands.
 */
export type PoolDemoResult = {
  amount: string;
  note: string;
  recipient: string;
  deposit: { txHash: string; explorerUrl: string };
  withdraw: { txHash: string; explorerUrl: string };
};

export async function runPoolDemo(input: PoolDemoInput): Promise<PoolDemoResult> {
  const recipient = Keypair.random();
  await fundWithFriendbot(recipient.publicKey());

  const deposit = await createPoolDeposit({ amount: input.amount });
  const withdraw = await createPoolWithdraw({ note: deposit.note, recipient: recipient.publicKey() });

  return {
    amount: input.amount,
    note: deposit.note,
    recipient: recipient.publicKey(),
    deposit: { txHash: deposit.txHash, explorerUrl: deposit.explorerUrl },
    withdraw: { txHash: withdraw.txHash, explorerUrl: withdraw.explorerUrl },
  };
}

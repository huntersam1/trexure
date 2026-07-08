import "server-only";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import { parseNote } from "@/lib/pool/note";
import { createPoolWithdraw } from "@/lib/pool/service";
import { poolContractId } from "@/lib/pool/sync";
import { buildPoolWalletReceipt, type PoolReceipt } from "@/lib/reconcile/receipt";
import { logger } from "@/lib/log";
import type { ClaimInput, ClaimBankPayout } from "@/lib/validation/pool";

/**
 * Receiver claim dispatch (P3, #85 / P4, #86). Validates + routes; the wallet
 * path (P4) is a real pool withdraw that settles the disbursement `Payment` and
 * emits an on-chain-only receipt. The bank path (P5, #87) is still stubbed.
 *
 * The note is a bearer credential — parsed defensively here, never logged.
 */
export type ClaimResult = {
  method: "wallet" | "bank";
  txHash: string;
  explorerUrl: string;
  paymentId?: string;
  receipt?: PoolReceipt;
};

/** Public field as stored on the disbursement `Payment` (see lib/pool/deposit.ts). */
const hex32 = (x: bigint): string => "0x" + x.toString(16).padStart(64, "0");

export async function submitClaim(receiverId: string, input: ClaimInput): Promise<ClaimResult> {
  // Belt-and-suspenders: the schema already validated round-trip parseability.
  parseNote(input.note);

  if (input.payout.method === "wallet") {
    return claimToWallet(receiverId, input.note, input.payout.address);
  }
  return claimToBank(receiverId, input.note, input.payout);
}

/**
 * P4 (#86) — wallet claim. Look up the disbursement `Payment` by the note's
 * public commitment, run the real pool withdraw straight to `address` (the tx IS
 * settlement — Rail A), then write the ONCHAIN leg + nullifier, advance the
 * payment to SETTLED, and build an on-chain-only receipt. Double-claim is
 * rejected here (DB pre-check) AND on-chain (the spent nullifier).
 */
async function claimToWallet(receiverId: string, noteString: string, address: string): Promise<ClaimResult> {
  const note = parseNote(noteString);
  const commitment = hex32(note.commitment);

  const payment = await prisma.payment.findFirst({ where: { poolCommitment: commitment } });
  if (!payment) {
    throw new AppError(404, "Unknown note", "No disbursement matches this note.");
  }
  if (payment.status === "SETTLED" || payment.poolNullifierHash) {
    throw new AppError(409, "Already claimed", "This note has already been claimed.");
  }

  // Real ZK withdraw. If the note was already spent on-chain (e.g. via the
  // standalone rail), the contract rejects it here even if the pre-check raced.
  const withdraw = await createPoolWithdraw({ note: noteString, recipient: address });

  await prisma.$transaction([
    prisma.paymentLeg.upsert({
      where: { paymentId_legType: { paymentId: payment.id, legType: "ONCHAIN" } },
      create: {
        paymentId: payment.id,
        legType: "ONCHAIN",
        status: "CONFIRMED",
        txHash: withdraw.txHash,
        ledger: withdraw.ledger,
        contractId: poolContractId(),
      },
      update: { status: "CONFIRMED", txHash: withdraw.txHash, ledger: withdraw.ledger },
    }),
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "SETTLED", poolNullifierHash: hex32(note.nullifierHash), receiverId },
    }),
  ]);

  const receipt = await buildPoolWalletReceipt(payment.id);
  logger.info({ paymentId: payment.id, txHash: withdraw.txHash }, "wallet claim settled");

  return {
    method: "wallet",
    txHash: withdraw.txHash,
    explorerUrl: withdraw.explorerUrl,
    paymentId: payment.id,
    receipt,
  };
}

// --- P5 (#87) implements this: withdraw to custody → mock PDAX off-ramp → FIAT
// leg → reconcile by intentId → Stripe-style receipt. ---
async function claimToBank(_receiverId: string, _note: string, _bank: ClaimBankPayout): Promise<ClaimResult> {
  throw new AppError(501, "Not implemented yet", "Bank claims are wired in P5 (#87).");
}

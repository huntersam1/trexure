import "server-only";

import { Keypair } from "@stellar/stellar-sdk";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/problem";
import { parseNote } from "@/lib/pool/note";
import { createPoolWithdraw } from "@/lib/pool/service";
import { poolContractId } from "@/lib/pool/sync";
import { triggerMockPayout } from "@/lib/anchor/mock";
import { tryReconcile } from "@/lib/reconcile/matcher";
import { quoteTargetAmount } from "@/lib/fx";
import { buildPoolWalletReceipt, type PoolReceipt, type Receipt } from "@/lib/reconcile/receipt";
import { logger } from "@/lib/log";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ClaimInput, ClaimBankPayout } from "@/lib/validation/pool";

/**
 * Receiver claim dispatch (P3–P5). Validates + routes:
 * - wallet (P4, #86): a pool withdraw straight to the address — the tx IS
 *   settlement (on-chain-only receipt).
 * - bank (P5, #87): withdraw into custody (ONCHAIN leg) + a mock PDAX off-ramp
 *   (FIAT leg) that reconcile by `intentId` into a SETTLED payment + fiat receipt.
 *
 * The note is a bearer credential — parsed defensively here, never logged.
 */
export type ClaimResult = {
  method: "wallet" | "bank";
  txHash: string;
  explorerUrl: string;
  paymentId?: string;
  receipt?: PoolReceipt | Receipt;
};

// Off-ramp corridor for pool bank claims (until real PDAX, #69).
const OFFRAMP_CURRENCY = "PHP";

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

/**
 * P5 (#87) — bank claim (the loop-closer). Withdraw the note into a custody
 * address (the ONCHAIN leg), then drive the mock PDAX off-ramp: it sells XLM→PHP
 * and pays the bank via the existing signed fiat webhook (the FIAT leg). The two
 * legs reconcile by `intentId` (corridor + 1% FX) into a SETTLED payment + a
 * Stripe-style receipt with the fiat block + bank ref.
 *
 * Failure routing: the withdraw happens FIRST (funds land in custody). If the
 * off-ramp then fails, the webhook marks the FIAT leg + payment FAILED and this
 * throws 502 — the XLM sits in custody for a manual refund (real PDAX, #69, would
 * automate the reversal).
 */
async function claimToBank(receiverId: string, noteString: string, bank: ClaimBankPayout): Promise<ClaimResult> {
  const note = parseNote(noteString);
  const commitment = hex32(note.commitment);

  const payment = await prisma.payment.findFirst({ where: { poolCommitment: commitment } });
  if (!payment) {
    throw new AppError(404, "Unknown note", "No disbursement matches this note.");
  }
  if (payment.status === "SETTLED" || payment.poolNullifierHash) {
    throw new AppError(409, "Already claimed", "This note has already been claimed.");
  }

  // 1) Real ZK withdraw into custody (the server/relayer account holds the XLM
  //    while the off-ramp settles). Rejected on-chain if the nullifier is spent.
  const custody = Keypair.fromSecret(env.STELLAR_SOURCE_SECRET).publicKey();
  const withdraw = await createPoolWithdraw({ note: noteString, recipient: custody });

  // 2) Finalize the disbursement as a fiat (PHP) corridor + write the ONCHAIN
  //    leg. targetAmount is the quoted PHP the off-ramp must land within 1%.
  const targetPhp = quoteTargetAmount(payment.sourceAmount, payment.sourceAsset, OFFRAMP_CURRENCY);
  if (!targetPhp) {
    throw new AppError(422, "Unsupported corridor", `No ${payment.sourceAsset}->${OFFRAMP_CURRENCY} quote.`);
  }
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
      data: {
        status: "ONCHAIN_CONFIRMED",
        payoutMethod: "POOL_BANK",
        poolNullifierHash: hex32(note.nullifierHash),
        receiverId,
        corridorTo: OFFRAMP_CURRENCY,
        targetCurrency: OFFRAMP_CURRENCY,
        targetAmount: targetPhp,
      } satisfies Prisma.PaymentUncheckedUpdateInput,
    }),
  ]);

  // 3) Mock PDAX off-ramp: sell XLM→PHP + pay the bank. Drives the REAL signed
  //    fiat webhook (same seam as real PDAX, #69) → writes the FIAT leg.
  await triggerMockPayout({
    intentId: payment.intentId,
    amount: targetPhp,
    currency: OFFRAMP_CURRENCY,
    recipientRef: `${bank.bankCode}/${bank.accountNumber}`,
    delayMs: 0, // synchronous so the claim can settle + receipt in one response
  });

  // 4) Reconcile ONCHAIN ↔ FIAT by intentId (idempotent — the webhook also
  //    enqueued a worker reconcile). Settles + builds the fiat receipt.
  const status = await tryReconcile(payment.id);
  if (status === "FAILED") {
    logger.warn({ paymentId: payment.id }, "bank claim off-ramp failed after withdraw (custody holds XLM)");
    throw new AppError(
      502,
      "Off-ramp failed",
      "The bank payout failed after withdrawal; the funds are held in custody for refund.",
    );
  }

  const receiptRow = await prisma.receipt.findUnique({ where: { paymentId: payment.id } });
  logger.info({ paymentId: payment.id, txHash: withdraw.txHash, status }, "bank claim processed");

  return {
    method: "bank",
    txHash: withdraw.txHash,
    explorerUrl: withdraw.explorerUrl,
    paymentId: payment.id,
    receipt: (receiptRow?.json as Receipt | undefined) ?? undefined,
  };
}

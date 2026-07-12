import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

import { Prisma } from "@/lib/generated/prisma/client";
import { NOTE_PREFIX, parseNote } from "@/lib/pool/note";

/**
 * Request schemas for the shielded-pool rail (P6, #65). Amounts are whole/decimal
 * XLM at the API edge (converted to stroops in the service); the note is the
 * bearer claim string; the recipient is a validated Stellar ed25519 public key.
 */

const stellarAddress = z
  .string()
  .refine((s) => StrKey.isValidEd25519PublicKey(s), "recipient must be a Stellar public key (G…)");

/**
 * A positive XLM amount as a DECIMAL STRING (#143 H2). Money never round-trips
 * through a JS `number` — a JSON number is normalized to its string form, then
 * validated with Prisma.Decimal (positive, <= 10000, <= 7 dp = XLM precision).
 * Callers hand this straight to the stroop conversion, no float in between.
 */
export const xlmAmount = z.preprocess(
  (v) => (typeof v === "number" ? v.toString() : v),
  z
    .string()
    .trim()
    .refine((v) => {
      try {
        const d = new Prisma.Decimal(v);
        return d.isFinite() && d.gt(0) && d.lte(10_000) && d.decimalPlaces() <= 7;
      } catch {
        return false;
      }
    }, "amount must be a positive XLM value (<= 10000, <= 7 decimal places)"),
);

export const poolDepositSchema = z.object({
  // XLM amount to shield into the pool. Bounded so a fat-fingered demo can't
  // drain the funded key; the pool custodies valueless testnet XLM regardless.
  amount: xlmAmount,
});

export const poolWithdrawSchema = z.object({
  note: z.string().startsWith(NOTE_PREFIX, "not a trexure pool note"),
  recipient: stellarAddress,
});

export const poolDemoSchema = z.object({
  amount: xlmAmount.default("10"),
});

/**
 * Batch send (P2, #84): one payer row → one pool deposit → one claimable note.
 * `ref` is a free-text label the payer uses to recognize the receiver (e.g. a
 * name or invoice id); `email` is captured for later delivery (#81/#82) but
 * unused here.
 */
export const poolBatchReceiverSchema = z.object({
  amount: xlmAmount,
  ref: z.string().trim().min(1, "receiver label is required").max(200),
  email: z.string().trim().email("invalid email").max(320).optional(),
});

export const poolBatchSchema = z.object({
  receivers: z.array(poolBatchReceiverSchema).min(1, "add at least one receiver").max(50),
});

/**
 * Receiver claim (P3, #85). The note is validated for prefix AND round-trip
 * parseability (a malformed hex body fails before any payout is attempted). The
 * payout is a discriminated choice: pay out to a Stellar wallet, or to a PH bank
 * account via the (mock, until #69) PDAX off-ramp. Wallet execution lands in P4
 * (#86), bank in P5 (#87).
 */
const claimableNote = z
  .string()
  .startsWith(NOTE_PREFIX, "not a trexure pool note")
  .refine((s) => {
    try {
      parseNote(s);
      return true;
    } catch {
      return false;
    }
  }, "malformed note");

export const claimWalletPayoutSchema = z.object({
  method: z.literal("wallet"),
  address: stellarAddress,
});

export const claimBankPayoutSchema = z.object({
  method: z.literal("bank"),
  bankCode: z.string().trim().min(1, "bank code is required").max(32),
  accountName: z.string().trim().min(1, "account name is required").max(140),
  accountNumber: z.string().trim().min(4, "account number is too short").max(34),
});

export const claimSchema = z.object({
  note: claimableNote,
  payout: z.discriminatedUnion("method", [claimWalletPayoutSchema, claimBankPayoutSchema]),
});

export type PoolDepositInput = z.infer<typeof poolDepositSchema>;
export type PoolWithdrawInput = z.infer<typeof poolWithdrawSchema>;
export type PoolDemoInput = z.infer<typeof poolDemoSchema>;
export type PoolBatchReceiverInput = z.infer<typeof poolBatchReceiverSchema>;
export type PoolBatchInput = z.infer<typeof poolBatchSchema>;
export type ClaimInput = z.infer<typeof claimSchema>;
export type ClaimBankPayout = z.infer<typeof claimBankPayoutSchema>;

import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

import { NOTE_PREFIX } from "@/lib/pool/note";

/**
 * Request schemas for the shielded-pool rail (P6, #65). Amounts are whole/decimal
 * XLM at the API edge (converted to stroops in the service); the note is the
 * bearer claim string; the recipient is a validated Stellar ed25519 public key.
 */

const stellarAddress = z
  .string()
  .refine((s) => StrKey.isValidEd25519PublicKey(s), "recipient must be a Stellar public key (G…)");

export const poolDepositSchema = z.object({
  // XLM amount to shield into the pool. Bounded so a fat-fingered demo can't
  // drain the funded key; the pool custodies valueless testnet XLM regardless.
  amount: z.coerce.number().positive().max(10_000),
});

export const poolWithdrawSchema = z.object({
  note: z.string().startsWith(NOTE_PREFIX, "not a trexure pool note"),
  recipient: stellarAddress,
});

export const poolDemoSchema = z.object({
  amount: z.coerce.number().positive().max(10_000).default(10),
});

/**
 * Batch send (P2, #84): one payer row → one pool deposit → one claimable note.
 * `ref` is a free-text label the payer uses to recognize the receiver (e.g. a
 * name or invoice id); `email` is captured for later delivery (#81/#82) but
 * unused here.
 */
export const poolBatchReceiverSchema = z.object({
  amount: z.coerce.number().positive().max(10_000),
  ref: z.string().trim().min(1, "receiver label is required").max(200),
  email: z.string().trim().email("invalid email").max(320).optional(),
});

export const poolBatchSchema = z.object({
  receivers: z.array(poolBatchReceiverSchema).min(1, "add at least one receiver").max(50),
});

export type PoolDepositInput = z.infer<typeof poolDepositSchema>;
export type PoolWithdrawInput = z.infer<typeof poolWithdrawSchema>;
export type PoolDemoInput = z.infer<typeof poolDemoSchema>;
export type PoolBatchReceiverInput = z.infer<typeof poolBatchReceiverSchema>;
export type PoolBatchInput = z.infer<typeof poolBatchSchema>;

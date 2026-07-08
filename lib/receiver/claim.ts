import "server-only";

import { AppError } from "@/lib/http/problem";
import { parseNote } from "@/lib/pool/note";
import type { ClaimInput, ClaimBankPayout } from "@/lib/validation/pool";

/**
 * Receiver claim dispatch (P3, #85). This phase builds the auth + interface +
 * validated form; the actual payout execution is stubbed with a clear boundary:
 * P4 (#86) fills `claimToWallet` (withdraw → settle → on-chain receipt) and P5
 * (#87) fills `claimToBank` (withdraw → mock PDAX off-ramp → reconcile → receipt).
 *
 * The note is a bearer credential — parsed defensively here, never logged.
 */
export type ClaimResult = {
  method: "wallet" | "bank";
  txHash: string;
  explorerUrl: string;
};

export async function submitClaim(receiverId: string, input: ClaimInput): Promise<ClaimResult> {
  // Belt-and-suspenders: the schema already validated round-trip parseability.
  parseNote(input.note);

  if (input.payout.method === "wallet") {
    return claimToWallet(receiverId, input.note, input.payout.address);
  }
  return claimToBank(receiverId, input.note, input.payout);
}

// --- P4 (#86) implements this: pool withdraw straight to `address`; the tx is
// settlement (on-chain-only receipt). ---
async function claimToWallet(_receiverId: string, _note: string, _address: string): Promise<ClaimResult> {
  throw new AppError(501, "Not implemented yet", "Wallet claims are wired in P4 (#86).");
}

// --- P5 (#87) implements this: withdraw to custody → mock PDAX off-ramp → FIAT
// leg → reconcile by intentId → Stripe-style receipt. ---
async function claimToBank(_receiverId: string, _note: string, _bank: ClaimBankPayout): Promise<ClaimResult> {
  throw new AppError(501, "Not implemented yet", "Bank claims are wired in P5 (#87).");
}

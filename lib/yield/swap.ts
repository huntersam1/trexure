import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client";

/**
 * Treasury Float Yield (#161 P2) — simulated USDC ↔ YLDS swap.
 *
 * Maintainer decision (issue #163): P2 uses a *simulated* swap leg — a
 * deterministic 1:1 peg minus a small demo-grade slippage, no real on-chain
 * hop. This keeps the sweep engine fully offline/testable and demo-safe. A real
 * testnet swap (trustline + DEX path payment) can later replace this module
 * without touching the eligibility, sweep, or persistence layers.
 *
 * Deterministic in the seed so tx hash / ledger / amounts are reproducible for
 * tests and reconciliation. No network, no funds move.
 */

const D = Prisma.Decimal;

/** Demo-grade DEX slippage for the swap, in basis points (0.05%). */
export const SWAP_SLIPPAGE_BPS = new D("5");

export type SimulatedSwap = {
  /** Input amount (source asset for a sweep-in, yield asset for a sweep-out). */
  fromAmount: string;
  /** Output amount after slippage. */
  toAmount: string;
  /** Effective fill rate (toAmount / fromAmount), 8dp. */
  rate: string;
  /** Absolute amount lost to slippage. */
  slippage: string;
  /** Stable pseudo tx hash derived from the seed. */
  txHash: string;
  /** Stable pseudo ledger derived from the seed. */
  ledger: number;
};

/**
 * Simulate a swap of `fromAmount` at a 1:1 peg minus {@link SWAP_SLIPPAGE_BPS}.
 * `seed` (e.g. `"in:<paymentId>"`) makes the tx hash/ledger deterministic and
 * distinct per hop.
 */
export function simulateSwap(seed: string, fromAmount: string): SimulatedSwap {
  const from = new D(fromAmount);
  const slippage = from.mul(SWAP_SLIPPAGE_BPS).div(10000);
  const to = from.minus(slippage);

  const hash = createHash("sha256").update(`yield-swap:${seed}`).digest("hex");
  // A stable, non-zero pseudo-ledger for receipt realism. 6 hex digits keeps it
  // in a plausible ledger-height band and safely within a 32-bit DB integer.
  const ledger = parseInt(hash.slice(0, 6), 16) + 1;
  const rate = from.gt(0) ? to.div(from).toFixed(8) : "0";

  return {
    fromAmount: from.toFixed(8),
    toAmount: to.toFixed(8),
    rate,
    slippage: slippage.toFixed(8),
    txHash: hash,
    ledger,
  };
}

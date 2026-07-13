import { Prisma } from "../generated/prisma/client";

/**
 * Treasury Float Yield (#161 P3) — yield accrual for a held position.
 *
 * A simulated, demo-grade model: the yield asset accrues linearly at a fixed
 * APY over the hold duration (funding → disbursement). A real integration would
 * read the on-chain yield-token appreciation instead; this keeps sweep-out
 * deterministic and offline. Pure Decimal math — no floats.
 */

const D = Prisma.Decimal;

/** Demo APY in basis points (5%). */
export const YIELD_APY_BPS = new D("500");

const MS_PER_YEAR = new D(365 * 24 * 60 * 60 * 1000);

/**
 * Yield earned on `principal` held for `heldMs` milliseconds at {@link YIELD_APY_BPS}.
 * `accrued = principal * (apyBps / 10000) * (heldMs / msPerYear)`. Clamped at 0
 * for a non-positive hold (clock skew / same-instant unwind).
 */
export function accrueYield(principal: string, heldMs: number): string {
  if (heldMs <= 0) return "0.00000000";
  const heldFraction = new D(heldMs).div(MS_PER_YEAR);
  return new D(principal).mul(YIELD_APY_BPS).div(10000).mul(heldFraction).toFixed(8);
}

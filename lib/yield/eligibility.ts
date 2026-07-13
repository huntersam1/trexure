import { Prisma } from "../generated/prisma/client";
import type { YieldConfigView } from "./config";

/**
 * Treasury Float Yield (#161 P2) — how much of a funded intent to sweep into the
 * yield asset. Keeps `minIdleBuffer` liquid (never swept) and only sweeps when
 * the remainder clears `sweepThreshold` (below that the swap cost dominates the
 * yield). Pure Decimal math — no floats, no I/O.
 */

const D = Prisma.Decimal;

export type SweepReason = "ok" | "disabled" | "within-buffer" | "below-threshold";

export type Eligibility = {
  /** Amount to sweep (Decimal string); "0" unless `reason === "ok"`. */
  eligible: string;
  reason: SweepReason;
};

/**
 * Given a funded intent's source amount and the tenant's yield config, decide
 * the sweep amount. `sourceAmount` is the idle float created by funding the
 * intent — the buffer is subtracted first, then the threshold gates the rest.
 */
export function computeSweepAmount(sourceAmount: string, config: YieldConfigView): Eligibility {
  if (!config.enabled) return { eligible: "0", reason: "disabled" };

  const eligible = new D(sourceAmount).minus(new D(config.minIdleBuffer));
  if (eligible.lte(0)) return { eligible: "0", reason: "within-buffer" };
  if (eligible.lt(new D(config.sweepThreshold))) return { eligible: "0", reason: "below-threshold" };

  return { eligible: eligible.toString(), reason: "ok" };
}

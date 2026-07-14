import "server-only";

import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { loadYieldConfig, type YieldConfigView } from "./config";
import { YIELD_APY_BPS } from "./accrual";

/**
 * Treasury Float Yield (#161 P5) — dashboard read model. Aggregates the tenant's
 * yield positions into the headline numbers: how much idle balance is currently
 * earning, the realized yield to date, and the effective APY. Sums happen in the
 * DB (bounded, exact Decimal) — never by pulling rows and reducing as floats.
 */

const D = Prisma.Decimal;

export type YieldDashboard = {
  config: YieldConfigView;
  asset: string;
  /** Sum of principal currently parked in yield (positions still SWEPT_IN). */
  inYieldBalance: string;
  activePositions: number;
  unwoundCount: number;
  failedCount: number;
  /** Realized gross yield across all positions. */
  accruedTotal: string;
  platformFeeTotal: string;
  netYieldTotal: string;
  /** Effective APY as a percent string (the demo yield rate), e.g. "5.00". */
  apy: string;
};

export async function loadYieldDashboard(tenantId: string): Promise<YieldDashboard> {
  const config = await loadYieldConfig(tenantId);
  const db = forTenant(tenantId);

  const [inYield, realized, activePositions, unwoundCount, failedCount] = await Promise.all([
    db.yieldPosition.aggregate({ where: { status: "SWEPT_IN" }, _sum: { principal: true } }),
    // Realized yield + the fee recorded per position at sweep-out (#161 P6) —
    // sum the stored figures, not a re-derivation from the current config rate.
    db.yieldPosition.aggregate({ _sum: { accruedYield: true, feeAmount: true } }),
    db.yieldPosition.count({ where: { status: "SWEPT_IN" } }),
    db.yieldPosition.count({ where: { status: "SWEPT_OUT" } }),
    db.yieldPosition.count({ where: { status: "FAILED" } }),
  ]);

  const accruedTotal = new D(realized._sum.accruedYield?.toString() ?? "0");
  const platformFeeTotal = new D(realized._sum.feeAmount?.toString() ?? "0");
  const netYieldTotal = accruedTotal.minus(platformFeeTotal);

  return {
    config,
    asset: config.yieldAsset,
    inYieldBalance: new D(inYield._sum.principal?.toString() ?? "0").toFixed(2),
    activePositions,
    unwoundCount,
    failedCount,
    accruedTotal: accruedTotal.toFixed(8),
    platformFeeTotal: platformFeeTotal.toFixed(8),
    netYieldTotal: netYieldTotal.toFixed(8),
    apy: YIELD_APY_BPS.div(100).toFixed(2),
  };
}

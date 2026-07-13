import "server-only";

import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { env } from "../env";
import { AppError } from "../http/problem";

/**
 * Treasury Float Yield (#161 P1) — per-tenant yield configuration.
 *
 * A tenant opts in to sweeping idle balance (above `minIdleBuffer`, once it
 * clears `sweepThreshold`) into a yield-bearing asset between funding and
 * disbursement. `feeBps` is the platform management fee in basis points
 * (default 0 → 100% of yield to the tenant). This module is config only; the
 * sweep engines land in P2 (#163) / P3 (#164).
 *
 * Money amounts are carried as validated Decimal strings (the money-as-string
 * convention, #143 H2), never JS floats.
 */

const D = Prisma.Decimal;

export type YieldConfigView = {
  enabled: boolean;
  yieldAsset: string;
  /** USDC (source asset) always kept liquid, never swept. */
  minIdleBuffer: string;
  /** Minimum eligible amount worth sweeping (below this the swap cost dominates). */
  sweepThreshold: string;
  /** Platform management fee on yield, in basis points (0–10000). */
  feeBps: string;
};

export type YieldConfigPatch = Partial<{
  enabled: boolean;
  yieldAsset: string;
  minIdleBuffer: string;
  sweepThreshold: string;
  feeBps: string;
}>;

/** Safe defaults for a tenant that has never configured yield: disabled, no sweeping. */
function defaults(): YieldConfigView {
  return {
    enabled: false,
    yieldAsset: env.YIELD_ASSET_CODE,
    minIdleBuffer: "0",
    sweepThreshold: "0",
    feeBps: "0",
  };
}

/** Returns the tenant's stored yield config, or safe disabled defaults if none exists. */
export async function loadYieldConfig(tenantId: string): Promise<YieldConfigView> {
  const row = await forTenant(tenantId).yieldConfig.findFirst();
  if (!row) return defaults();
  return {
    enabled: row.enabled,
    yieldAsset: row.yieldAsset,
    minIdleBuffer: row.minIdleBuffer.toString(),
    sweepThreshold: row.sweepThreshold.toString(),
    feeBps: row.feeBps.toString(),
  };
}

/** Non-negative Decimal amount (money). Throws AppError 422 on a bad value. */
function amount(value: string, field: string): string {
  let dec: Prisma.Decimal;
  try {
    dec = new D(value);
  } catch {
    throw new AppError(422, "Invalid yield config", `${field} is not a number`);
  }
  if (!dec.isFinite() || dec.lt(0)) {
    throw new AppError(422, "Invalid yield config", `${field} must be a non-negative number`);
  }
  return dec.toString();
}

/** Basis points in [0, 10000]. Throws AppError 422 on a bad value. */
function bps(value: string): string {
  let dec: Prisma.Decimal;
  try {
    dec = new D(value);
  } catch {
    throw new AppError(422, "Invalid yield config", "feeBps is not a number");
  }
  if (!dec.isFinite() || dec.lt(0) || dec.gt(10000)) {
    throw new AppError(422, "Invalid yield config", "feeBps must be between 0 and 10000");
  }
  return dec.toString();
}

/**
 * Upserts the tenant's yield config, merging `patch` over the current values
 * (or defaults). Returns the resulting view.
 */
export async function saveYieldConfig(
  tenantId: string,
  patch: YieldConfigPatch,
): Promise<YieldConfigView> {
  const current = await loadYieldConfig(tenantId);
  const merged = {
    enabled: patch.enabled ?? current.enabled,
    yieldAsset: patch.yieldAsset ?? current.yieldAsset,
    minIdleBuffer: amount(patch.minIdleBuffer ?? current.minIdleBuffer, "minIdleBuffer"),
    sweepThreshold: amount(patch.sweepThreshold ?? current.sweepThreshold, "sweepThreshold"),
    feeBps: bps(patch.feeBps ?? current.feeBps),
  };

  // Atomic upsert on the unique tenantId — no findFirst→create race (P2002) for
  // a brand-new tenant.
  await forTenant(tenantId).yieldConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...merged } as Prisma.YieldConfigUncheckedCreateInput,
    update: merged,
  });
  return loadYieldConfig(tenantId);
}

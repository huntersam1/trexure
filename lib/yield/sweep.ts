import "server-only";

import { forTenant, prisma } from "../db";
import { env } from "../env";
import { Prisma } from "../generated/prisma/client";
import { logger } from "../log";
import { recordAudit } from "../audit/log";
import { loadYieldConfig } from "./config";
import { computeSweepAmount } from "./eligibility";
import { accrueYield } from "./accrual";
import { simulateSwap } from "./swap";

/**
 * Treasury Float Yield (#161 P2) — sweep-in engine.
 *
 * When a yield-enabled tenant funds a payment intent, sweep the eligible idle
 * balance into the yield asset (simulated swap, see `./swap`), record a
 * `YieldPosition`, and transition the payment to `SWEPT_IN`.
 *
 * Flag-gated: a pure no-op unless `ENABLE_YIELD` and the tenant's `YieldConfig`
 * are both on. Idempotent: a payment that already has a position is a no-op.
 */

export type SweepInResult =
  | { swept: false; reason: string }
  | {
      swept: true;
      positionId: string;
      principal: string;
      sweptInAmount: string;
      alreadyDone?: boolean;
    };

function fromPosition(p: {
  id: string;
  principal: Prisma.Decimal;
  sweptInAmount: Prisma.Decimal | null;
}): SweepInResult {
  return {
    swept: true,
    positionId: p.id,
    principal: p.principal.toString(),
    sweptInAmount: p.sweptInAmount?.toString() ?? "0",
    alreadyDone: true,
  };
}

export async function sweepIn(tenantId: string, paymentId: string): Promise<SweepInResult> {
  if (!env.ENABLE_YIELD) return { swept: false, reason: "feature-disabled" };

  const db = forTenant(tenantId);

  // Idempotency: never sweep the same payment twice.
  const existing = await db.yieldPosition.findUnique({ where: { paymentId } });
  if (existing) return fromPosition(existing);

  const payment = await db.payment.findFirst({
    where: { id: paymentId },
    select: { id: true, sourceAmount: true },
  });
  if (!payment) return { swept: false, reason: "payment-not-found" };

  const config = await loadYieldConfig(tenantId);
  const { eligible, reason } = computeSweepAmount(payment.sourceAmount.toString(), config);
  if (reason !== "ok") return { swept: false, reason };

  const swap = simulateSwap(`in:${paymentId}`, eligible);

  try {
    const position = await prisma.$transaction(async (tx) => {
      const created = await tx.yieldPosition.create({
        data: {
          tenantId,
          paymentId,
          status: "SWEPT_IN",
          yieldAsset: config.yieldAsset,
          principal: eligible,
          sweptInAmount: swap.toAmount,
          feeBps: config.feeBps,
          sweepInTxHash: swap.txHash,
          sweepInLedger: swap.ledger,
        } as Prisma.YieldPositionUncheckedCreateInput,
      });
      // Transition PENDING → SWEPT_IN. Guarded + tenant-scoped so it never
      // clobbers another state or another tenant's row.
      await tx.payment.updateMany({
        where: { id: paymentId, tenantId, status: "PENDING" },
        data: { status: "SWEPT_IN" },
      });
      return created;
    });

    logger.info(
      { paymentId, principal: eligible, ylds: swap.toAmount, tx: swap.txHash },
      "yield sweep-in complete",
    );
    return {
      swept: true,
      positionId: position.id,
      principal: eligible,
      sweptInAmount: swap.toAmount,
    };
  } catch (e) {
    // Unique-constraint race: a concurrent sweep-in beat us to it. Treat as done.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const now = await db.yieldPosition.findUnique({ where: { paymentId } });
      if (now) return fromPosition(now);
    }
    throw e;
  }
}

/**
 * Treasury Float Yield (#161 P3) — sweep-out engine + liquidity-sacred fallback.
 *
 * At disbursement, unwind the payment's `YieldPosition` (yield asset → USDC),
 * record the accrued yield, and transition it to `SWEPT_OUT` so the liquid funds
 * back the payout. **Liquidity is sacred**: if the unwind fails, mark the
 * position `FAILED`, raise an alert, and return a `fallback` result — the caller
 * disburses from the liquid `minIdleBuffer` and the payout window is never
 * missed. This function never throws.
 *
 * Flag-gated + position-gated + idempotent: a payment with no `SWEPT_IN`
 * position is a pure no-op.
 */
export type SweepOutResult =
  | { status: "skipped"; reason: string }
  | {
      status: "unwound";
      positionId: string;
      sweptOutAmount: string;
      accruedYield: string;
      alreadyDone?: boolean;
    }
  | { status: "fallback"; positionId: string; reason: string; shortfall: string };

export async function sweepOut(
  tenantId: string,
  paymentId: string,
  opts?: { now?: Date },
): Promise<SweepOutResult> {
  if (!env.ENABLE_YIELD) return { status: "skipped", reason: "feature-disabled" };

  const db = forTenant(tenantId);
  const pos = await db.yieldPosition.findUnique({ where: { paymentId } });
  if (!pos) return { status: "skipped", reason: "no-position" };

  // Idempotency: already unwound / already fell back → replay the prior outcome
  // without re-swapping or re-alerting.
  if (pos.status === "SWEPT_OUT") {
    return {
      status: "unwound",
      positionId: pos.id,
      sweptOutAmount: pos.sweptOutAmount?.toString() ?? "0",
      accruedYield: pos.accruedYield.toString(),
      alreadyDone: true,
    };
  }
  if (pos.status === "FAILED") {
    return {
      status: "fallback",
      positionId: pos.id,
      reason: "previously-failed",
      shortfall: pos.principal.toString(),
    };
  }
  if (pos.status !== "SWEPT_IN") return { status: "skipped", reason: `position-${pos.status}` };

  const principal = pos.principal.toString();
  const now = opts?.now ?? new Date();
  const accrued = accrueYield(principal, now.getTime() - pos.createdAt.getTime());
  // Platform management fee, recorded per position (#161 P6): feeBps × accrued,
  // using the rate snapshotted at sweep-in. Default 0 bps → 0 fee. The tenant
  // keeps accrued − fee.
  const feeAmount = new Prisma.Decimal(accrued).mul(pos.feeBps).div(10000).toFixed(8);
  // The yield asset is worth principal + accrued in USDC terms; unwinding swaps
  // that gross value back, minus the swap slippage.
  const grossReturn = new Prisma.Decimal(principal).plus(accrued).toString();

  try {
    const swap = simulateSwap(`out:${paymentId}`, grossReturn);

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.yieldPosition.updateMany({
        where: { paymentId, tenantId, status: "SWEPT_IN" }, // guard: idempotent
        data: {
          status: "SWEPT_OUT",
          sweptOutAmount: swap.toAmount,
          accruedYield: accrued,
          feeAmount,
          sweepOutTxHash: swap.txHash,
          sweepOutLedger: swap.ledger,
        },
      });
      if (res.count === 0) return false; // a concurrent sweep-out won
      // Mark the payment SWEPT_OUT (transient, at disbursement). Never clobber a
      // terminal state or another tenant's row.
      await tx.payment.updateMany({
        where: { id: paymentId, tenantId, status: { notIn: ["SETTLED", "FAILED", "SWEPT_OUT"] } },
        data: { status: "SWEPT_OUT" },
      });
      return true;
    });

    if (!updated) {
      const fresh = await db.yieldPosition.findUnique({ where: { paymentId } });
      return {
        status: "unwound",
        positionId: fresh!.id,
        sweptOutAmount: fresh!.sweptOutAmount?.toString() ?? "0",
        accruedYield: fresh!.accruedYield.toString(),
        alreadyDone: true,
      };
    }

    logger.info(
      { paymentId, principal, accrued, returned: swap.toAmount, tx: swap.txHash },
      "yield sweep-out complete",
    );
    return {
      status: "unwound",
      positionId: pos.id,
      sweptOutAmount: swap.toAmount,
      accruedYield: accrued,
    };
  } catch (unwindErr) {
    // LIQUIDITY-SACRED FALLBACK — the unwind failed. Never block the payout: flag
    // the position, alert, and let the caller disburse from the liquid buffer.
    await db.yieldPosition.updateMany({
      where: { paymentId, tenantId },
      data: { status: "FAILED" },
    });
    logger.error(
      { paymentId, tenantId, principal, err: unwindErr },
      "yield unwind FAILED — disbursement served from liquid buffer",
    );
    await recordAudit({
      action: "yield.unwind.failed",
      tenantId,
      target: paymentId,
      metadata: { principal, error: String(unwindErr) },
    });
    return {
      status: "fallback",
      positionId: pos.id,
      reason: "unwind-failed-served-from-buffer",
      shortfall: principal,
    };
  }
}

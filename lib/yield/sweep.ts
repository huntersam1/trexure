import "server-only";

import { forTenant, prisma } from "../db";
import { env } from "../env";
import { Prisma } from "../generated/prisma/client";
import { logger } from "../log";
import { loadYieldConfig } from "./config";
import { computeSweepAmount } from "./eligibility";
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

import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { computeSalaryPayout, settleAdvancesForPayout } from "@/lib/hr/advances";
import { getEmployee } from "@/lib/hr/employees";
import { createPoolBatch } from "@/lib/pool/batch";
import { Prisma } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs"; // pool payout (Stellar/ZK)
export const dynamic = "force-dynamic";

/**
 * Run this employee's salary payout: pay the net (monthly base − outstanding
 * advances) via the pool rail, then net the deduction against the outstanding
 * advances (FIFO) and mark them repaid. This is the "next payroll cycle" the
 * salary-advance repayment settles against (#134). ADMIN only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    if (!env.ENABLE_POOL_RAIL) {
      return problem(503, "Payout rail disabled", "The pool payout rail is disabled; salary cannot be paid out here.");
    }
    const { id } = await ctx.params;

    const employee = await getEmployee(session.tenantId, id);
    if (!employee) return problem(404, "Not found", "Employee not found");

    const payout = await computeSalaryPayout(session.tenantId, id);
    if (new Prisma.Decimal(payout.gross).lte(0)) {
      return problem(409, "No salary", "This employee has no base salary in their current package.");
    }

    let salaryPaymentId = `salary-netted-${id}`; // net == 0 → fully offset by advances, no cash leg
    const net = new Prisma.Decimal(payout.net);
    if (net.gt(0)) {
      const batch = await createPoolBatch(session.tenantId, session.id, {
        receivers: [{ amount: Number(payout.net), ref: `Salary — ${employee.name}`, email: employee.email }],
      });
      const row = batch.results[0];
      if (!row || !row.ok) {
        return problem(502, "Payout failed", "Could not pay the net salary; advances were not settled. Retry.");
      }
      salaryPaymentId = row.paymentId;
    }

    const repaid = await settleAdvancesForPayout(
      session.tenantId,
      id,
      new Prisma.Decimal(payout.deduction),
      salaryPaymentId,
    );

    return NextResponse.json(
      {
        payout: { gross: payout.gross, deduction: payout.deduction, net: payout.net, currency: payout.currency },
        repaid: repaid.toString(),
        salaryPaymentId: net.gt(0) ? salaryPaymentId : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "pay salary failed");
    return problem(500, "Payout failed", "Could not run the salary payout");
  }
}

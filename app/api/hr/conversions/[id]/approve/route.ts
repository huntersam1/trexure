import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { approveConversion, markConversionDisbursed } from "@/lib/hr/conversions";
import { getEmployee } from "@/lib/hr/employees";
import { createPoolBatch } from "@/lib/pool/batch";
import { recordAudit } from "@/lib/audit/log";
import { env } from "@/lib/env";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs"; // pool payout (Stellar/ZK)
export const dynamic = "force-dynamic";

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

/**
 * Approve a conversion and pay out the net cash via the existing pool rail
 * (#80's `createPoolBatch`, single receiver). Payout depends on ENABLE_POOL_RAIL,
 * so guard on it up front (before any state change) rather than failing mid-way.
 *
 * If the payout itself fails, the conversion is left APPROVED. It is NOT
 * re-approvable (this route only approves a REQUESTED conversion); to recover,
 * reject it — which releases the reserved balance — and re-request.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    if (!env.ENABLE_POOL_RAIL) {
      return problem(503, "Payout rail disabled", "The pool payout rail is disabled; conversions cannot be paid out here.");
    }
    const { id } = await ctx.params;

    const approved = await approveConversion(session.tenantId, id, session.id);
    const employee = await getEmployee(session.tenantId, approved.employeeId);
    if (!employee) return problem(404, "Not found", "Employee not found");

    const batch = await createPoolBatch(session.tenantId, session.id, {
      receivers: [
        { amount: approved.net, ref: `Conversion — ${employee.name}`, email: employee.email },
      ],
    });
    const row = batch.results[0];
    if (!row || !row.ok) {
      return problem(502, "Payout failed", "The conversion is approved but the payout could not be created; retry.");
    }

    const disbursed = await markConversionDisbursed(session.tenantId, id, row.paymentId);
    await recordAudit({
      action: "hr.conversion.disburse",
      userId: session.id,
      tenantId: session.tenantId,
      target: disbursed.id,
      metadata: { employeeId: approved.employeeId, net: approved.net, paymentId: row.paymentId, batchId: batch.batchId },
      ip: clientIp(req),
    });
    return NextResponse.json(
      { conversion: disbursed, payout: { paymentId: row.paymentId, batchId: batch.batchId } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "approve+disburse conversion failed");
    return problem(500, "Approve failed", "Could not approve the conversion");
  }
}

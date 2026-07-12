import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { approveAdvance, markAdvanceDisbursed } from "@/lib/hr/advances";
import { getEmployee } from "@/lib/hr/employees";
import { createPoolBatch } from "@/lib/pool/batch";
import { recordAudit } from "@/lib/audit/log";
import { env } from "@/lib/env";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

export const runtime = "nodejs"; // pool payout (Stellar/ZK)
export const dynamic = "force-dynamic";

/**
 * Approve a salary advance and pay out the principal via the existing pool rail.
 * Guarded on ENABLE_POOL_RAIL up front. If the payout fails the advance stays
 * APPROVED; recover by rejecting (clears it) and re-requesting.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    if (!env.ENABLE_POOL_RAIL) {
      return problem(503, "Payout rail disabled", "The pool payout rail is disabled; advances cannot be paid out here.");
    }
    const { id } = await ctx.params;

    const approved = await approveAdvance(session.tenantId, id);
    const employee = await getEmployee(session.tenantId, approved.employeeId);
    if (!employee) return problem(404, "Not found", "Employee not found");

    const batch = await createPoolBatch(session.tenantId, session.id, {
      receivers: [{ amount: approved.amount, ref: `Advance — ${employee.name}`, email: employee.email }],
    });
    const row = batch.results[0];
    if (!row || !row.ok) {
      return problem(502, "Payout failed", "The advance is approved but the payout could not be created; reject and re-request.");
    }

    const disbursed = await markAdvanceDisbursed(session.tenantId, id, row.paymentId);
    await recordAudit({
      action: "hr.advance.disburse",
      userId: session.id,
      tenantId: session.tenantId,
      target: disbursed.id,
      metadata: { employeeId: approved.employeeId, amount: approved.amount, paymentId: row.paymentId, batchId: batch.batchId },
      ip: clientIp(req),
    });
    return NextResponse.json(
      { advance: disbursed, payout: { paymentId: row.paymentId, batchId: batch.batchId } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "approve+disburse advance failed");
    return problem(500, "Approve failed", "Could not approve the advance");
  }
}

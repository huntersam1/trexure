import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { approveConversion, markConversionDisbursed } from "@/lib/hr/conversions";
import { getEmployee } from "@/lib/hr/employees";
import { createPoolBatch } from "@/lib/pool/batch";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs"; // pool payout (Stellar/ZK)
export const dynamic = "force-dynamic";

/**
 * Approve a conversion and pay out the net cash via the existing pool rail
 * (#80's `createPoolBatch`, single receiver). If the payout fails the conversion
 * stays APPROVED (retryable) rather than being marked disbursed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const { id } = await ctx.params;

    const approved = await approveConversion(session.tenantId, id, session.id);
    const employee = await getEmployee(session.tenantId, approved.employeeId);
    if (!employee) return problem(404, "Not found", "Employee not found");

    const batch = await createPoolBatch(session.tenantId, session.id, {
      receivers: [
        { amount: Number(approved.net), ref: `Conversion — ${employee.name}`, email: employee.email },
      ],
    });
    const row = batch.results[0];
    if (!row || !row.ok) {
      return problem(502, "Payout failed", "The conversion is approved but the payout could not be created; retry.");
    }

    const disbursed = await markConversionDisbursed(session.tenantId, id, row.paymentId);
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

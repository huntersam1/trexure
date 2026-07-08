import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";
import { parseDateRange, toDateInput } from "@/lib/reports/scope";
import {
  buildPayrollRegister,
  payrollRegisterToCsv,
  payrollRegisterToPdf,
} from "@/lib/reports/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/payroll?batchId=&from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|pdf
 *
 * Disbursement / Payroll Register (R3). Scoped to one batch (`batchId`) or a date
 * range across batches. ADMIN-only (financial data), tenant-isolated in the
 * builder, audit-logged, and streamed as an attachment.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();

    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
    const batchId = url.searchParams.get("batchId")?.trim() || null;
    // A batch scope ignores the date range; otherwise fall back to the period.
    const range = batchId
      ? null
      : parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));

    const register = await buildPayrollRegister(admin.tenantId, { batchId, range });

    const scopeSlug = batchId
      ? `batch-${batchId}`
      : `${toDateInput(range!.from)}_${toDateInput(range!.to)}`;

    await recordAudit({
      action: "report.generate",
      tenantId: admin.tenantId,
      userId: admin.id,
      target: `payroll:${scopeSlug}`,
      metadata: {
        report: "payroll",
        format,
        batchId,
        disbursementCount: register.totals.disbursementCount,
        claimed: register.totals.claimed,
        unclaimed: register.totals.unclaimed,
        failed: register.totals.failed,
      },
    });

    const filename = `payroll-${scopeSlug}`;

    if (format === "pdf") {
      const pdf = await payrollRegisterToPdf(register);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }

    const csv = payrollRegisterToCsv(register);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "payroll register generation failed");
    return problem(500, "Internal Server Error", "Could not generate the payroll register.");
  }
}

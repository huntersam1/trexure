import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { problem, AppError } from "@/lib/http/problem";
import { parseDateRange, toDateInput } from "@/lib/reports/scope";
import {
  buildReconciliationStatement,
  reconciliationToCsv,
  reconciliationToPdf,
} from "@/lib/reports/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|pdf
 *
 * Reconciliation / Settlement Statement export. ADMIN-only (reports are
 * sensitive financial data), tenant-isolated via the report builder's
 * `forTenant`, and every generation is audit-logged. Streams the file as an
 * attachment (no server-side persistence needed for R1).
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();

    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
    const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));

    const statement = await buildReconciliationStatement(admin.tenantId, range);

    const from = toDateInput(range.from);
    const to = toDateInput(range.to);

    await recordAudit({
      action: "report.generate",
      tenantId: admin.tenantId,
      userId: admin.id,
      target: `reconciliation:${from}..${to}`,
      metadata: {
        report: "reconciliation",
        format,
        from,
        to,
        settledCount: statement.totals.settledCount,
        exceptionCount: statement.totals.exceptionCount,
      },
    });

    const filename = `reconciliation-${from}_${to}`;

    if (format === "pdf") {
      const pdf = await reconciliationToPdf(statement);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }

    const csv = reconciliationToCsv(statement);
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
    return problem(400, "Bad Request", "Could not generate the reconciliation report.");
  }
}

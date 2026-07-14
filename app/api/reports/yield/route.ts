import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { problem, AppError } from "@/lib/http/problem";
import { parseDateRange, toDateInput } from "@/lib/reports/scope";
import {
  buildYieldAttribution,
  yieldAttributionToCsv,
  yieldAttributionToPdf,
} from "@/lib/reports/yield-attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/yield?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|pdf
 *
 * Yield Attribution export (#161 P6). ADMIN-only, tenant-isolated via the report
 * builder's `forTenant`, every generation audit-logged. Streams the file.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();

    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
    const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));

    const report = await buildYieldAttribution(admin.tenantId, range);

    const from = toDateInput(range.from);
    const to = toDateInput(range.to);

    await recordAudit({
      action: "report.generate",
      tenantId: admin.tenantId,
      userId: admin.id,
      target: `yield:${from}..${to}`,
      metadata: { report: "yield", format, from, to, positionCount: report.totals.positionCount },
    });

    const filename = `yield-attribution-${from}_${to}`;

    if (format === "pdf") {
      const pdf = await yieldAttributionToPdf(report);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }

    const csv = yieldAttributionToCsv(report);
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
    return problem(400, "Bad Request", "Could not generate the yield attribution report.");
  }
}

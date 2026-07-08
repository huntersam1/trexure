import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";
import { parseDateRange, toDateInput } from "@/lib/reports/scope";
import { buildFxSummary, fxSummaryToCsv, fxSummaryToPdf } from "@/lib/reports/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/fx?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|pdf
 *
 * FX Realized Gain/Loss & Fees Summary (R5). ADMIN-only (treasury/tax data),
 * tenant-isolated in the builder, audit-logged, streamed as an attachment.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();

    const url = new URL(req.url);
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
    const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));

    const summary = await buildFxSummary(admin.tenantId, range);

    const from = toDateInput(range.from);
    const to = toDateInput(range.to);

    await recordAudit({
      action: "report.generate",
      tenantId: admin.tenantId,
      userId: admin.id,
      target: `fx:${from}..${to}`,
      metadata: { report: "fx", format, from, to, paymentCount: summary.paymentCount },
      ip: req.headers.get("x-forwarded-for"),
    });

    const filename = `fx-summary-${from}_${to}`;

    if (format === "pdf") {
      const pdf = await fxSummaryToPdf(summary);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }

    const csv = fxSummaryToCsv(summary);
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
    logger.error({ err }, "fx summary generation failed");
    return problem(500, "Internal Server Error", "Could not generate the FX summary.");
  }
}

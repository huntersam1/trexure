import { requireAdmin } from "@/lib/auth/session";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";
import { parseDateRange, toDateInput } from "@/lib/reports/scope";
import {
  buildDisclosurePack,
  disclosurePackToCsv,
  disclosurePackToJson,
  disclosurePackToPdf,
} from "@/lib/reports/disclosure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/disclosure?from=YYYY-MM-DD&to=YYYY-MM-DD&counterparty=&format=pdf|csv|json
 *
 * Compliance & Audit Disclosure Pack (R2). ADMIN-only — decrypting shielded
 * payments under the tenant view key is the most sensitive action in the app.
 * The builder is tenant-isolated (`forTenant`) and audit-logs every reveal plus
 * the pack itself, so this route only gates, generates, and streams the file as
 * an attachment (PDF for filing, CSV/JSON appendix for auditors to script).
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();

    // Decrypting under the tenant view key is sensitive and this is a GET (a
    // download link, so the double-submit CSRF token can't ride it). Reject an
    // explicit cross-site trigger — e.g. a forged `<img src>` that would force a
    // logged-in admin's browser to mass-decrypt. Same-origin / direct-navigation
    // (`none`) / header-less requests still pass, so the download UX is intact.
    if (req.headers.get("sec-fetch-site") === "cross-site") {
      return problem(403, "Forbidden", "Cross-site request not allowed.");
    }

    const url = new URL(req.url);
    const fmt = url.searchParams.get("format");
    const format = fmt === "pdf" ? "pdf" : fmt === "json" ? "json" : "csv";
    const counterparty = url.searchParams.get("counterparty");
    const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));

    // Decrypts + audits internally (per-payment viewkey.decrypt + pack-level
    // report.disclosure); never returns the view key.
    const pack = await buildDisclosurePack(admin.tenantId, range, {
      counterparty,
      actorUserId: admin.id,
      ip: req.headers.get("x-forwarded-for"),
    });

    const from = toDateInput(range.from);
    const to = toDateInput(range.to);
    const cpSlug = pack.counterparty ? `-${pack.counterparty.replace(/[^a-zA-Z0-9]+/g, "_")}` : "";
    const filename = `disclosure-${from}_${to}${cpSlug}`;

    if (format === "pdf") {
      const pdf = await disclosurePackToPdf(pack);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }

    if (format === "json") {
      return new Response(disclosurePackToJson(pack), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}.json"`,
          "cache-control": "no-store",
        },
      });
    }

    return new Response(disclosurePackToCsv(pack), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    // A non-AppError here is an unexpected server/infra failure (DB down, PDF
    // render error, a failed fail-closed audit write) — surface it as 500 with a
    // stack for ops, not a misleading 400.
    logger.error({ err }, "disclosure pack generation failed");
    return problem(500, "Internal Server Error", "Could not generate the disclosure pack.");
  }
}

import { requireSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";
import { buildAttestation, attestationToJson, attestationToPdf } from "@/lib/reports/attestation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/attestation?paymentId=<id>&format=pdf|json
 *
 * Proof-of-Payment Attestation (R4) for one SETTLED payment. Available to any
 * member of the owning tenant (ADMIN or MEMBER — it's the tenant's own payment),
 * tenant-isolated in the builder (`forTenant`), and audit-logged. Streams a
 * self-contained document (PDF for sharing, JSON for machine verification). Only
 * the one payment is exposed — no ledger leakage.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requireSession();

    const url = new URL(req.url);
    const paymentId = url.searchParams.get("paymentId")?.trim();
    if (!paymentId) throw new AppError(400, "Bad Request", "paymentId is required.");
    const format = url.searchParams.get("format") === "json" ? "json" : "pdf";

    const att = await buildAttestation(user.tenantId, paymentId);

    await recordAudit({
      action: "report.generate",
      tenantId: user.tenantId,
      userId: user.id,
      target: `attestation:${paymentId}`,
      metadata: { report: "attestation", format, paymentId, rail: att.rail },
      ip: req.headers.get("x-forwarded-for"),
    });

    const filename = `attestation-${paymentId}`;

    if (format === "json") {
      return new Response(attestationToJson(att), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}.json"`,
          "cache-control": "no-store",
        },
      });
    }

    const pdf = await attestationToPdf(att);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "attestation generation failed");
    return problem(500, "Internal Server Error", "Could not generate the attestation.");
  }
}

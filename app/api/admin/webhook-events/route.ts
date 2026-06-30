import { requireAdmin } from "../../../../lib/auth/session";
import { listWebhookEvents } from "../../../../lib/admin/queries";
import { recordAudit } from "../../../../lib/audit/log";
import { AppError, problem } from "../../../../lib/http/problem";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;

    const rows = await listWebhookEvents(limit);
    await recordAudit({ action: "admin.webhook_events.list", userId: admin.id, metadata: { count: rows.length } });

    return Response.json({
      events: rows.map((e) => ({
        id: e.id,
        provider: e.provider,
        externalId: e.externalId,
        verified: e.verified,
        idempotency: e.processedAt ? ("processed" as const) : ("pending" as const),
        processedAt: e.processedAt ? e.processedAt.toISOString() : null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal Server Error");
  }
}

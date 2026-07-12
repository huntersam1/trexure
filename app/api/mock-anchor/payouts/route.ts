import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma, forTenant } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { problem, AppError } from "@/lib/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!env.ENABLE_MOCK_ANCHOR) {
    return problem(404, "Not Found", "Mock anchor is disabled");
  }
  try {
    const session = await requireSession();
    const events = await prisma.webhookEvent.findMany({
      where: { provider: env.ANCHOR_PROVIDER },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // WebhookEvent is a global model (no tenantId), so scope by the payout's
    // intentId to the caller's tenant — otherwise this leaks every tenant's
    // payout payloads to any signed-in member (#143).
    const intentIds = [
      ...new Set(
        events.map((e) => (e.payload as { intentId?: string } | null)?.intentId).filter((x): x is string => Boolean(x)),
      ),
    ];
    const owned = new Set(
      intentIds.length === 0
        ? []
        : (
            await forTenant(session.tenantId).payment.findMany({
              where: { intentId: { in: intentIds } },
              select: { intentId: true },
            })
          ).map((p) => p.intentId),
    );
    const payouts = events
      .filter((e) => owned.has((e.payload as { intentId?: string } | null)?.intentId ?? ""))
      .map((e) => ({
        externalId: e.externalId,
        verified: e.verified,
        processedAt: e.processedAt,
        createdAt: e.createdAt,
        payload: e.payload,
      }));
    return NextResponse.json({ payouts });
  } catch (e) {
    if (e instanceof AppError) return problem(e.status, e.title, e.detail);
    throw e;
  }
}

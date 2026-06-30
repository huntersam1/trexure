import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { problem, AppError } from "@/lib/http/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!env.ENABLE_MOCK_ANCHOR) {
    return problem(404, "Not Found", "Mock anchor is disabled");
  }
  try {
    await requireSession();
    const events = await prisma.webhookEvent.findMany({
      where: { provider: env.ANCHOR_PROVIDER },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const payouts = events.map((e) => ({
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

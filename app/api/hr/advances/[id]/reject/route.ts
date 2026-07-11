import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { rejectAdvance } from "@/lib/hr/advances";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reject a not-yet-disbursed advance. ADMIN only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const { id } = await ctx.params;
    const advance = await rejectAdvance(session.tenantId, id);
    return NextResponse.json({ advance }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "reject advance failed");
    return problem(500, "Reject failed", "Could not reject the advance");
  }
}

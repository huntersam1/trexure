import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { rejectConversion } from "@/lib/hr/conversions";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reject a pending/approved conversion and release the reserved balance. ADMIN only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const { id } = await ctx.params;
    const conversion = await rejectConversion(session.tenantId, id, session.id);
    return NextResponse.json({ conversion }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "reject conversion failed");
    return problem(500, "Reject failed", "Could not reject the conversion");
  }
}

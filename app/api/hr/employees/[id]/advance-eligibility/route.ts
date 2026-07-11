import "server-only";

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { computeEligibility } from "@/lib/hr/advances";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The employee's current advance eligibility (accrued × policy − outstanding). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const eligibility = await computeEligibility(session.tenantId, id);
    return NextResponse.json({ eligibility }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "advance eligibility failed");
    return problem(500, "Fetch failed", "Could not compute eligibility");
  }
}

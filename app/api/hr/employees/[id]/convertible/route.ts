import "server-only";

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { listConvertibleItems } from "@/lib/hr/conversions";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List an employee's convertible package items with remaining balance + estimated cash. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const items = await listConvertibleItems(session.tenantId, id);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "list convertible items failed");
    return problem(500, "List failed", "Could not list convertible items");
  }
}

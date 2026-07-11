import "server-only";

import { NextResponse } from "next/server";

import { requireSession, requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { requestAdvance, listAdvances, advanceRequestInput } from "@/lib/hr/advances";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List salary advances (optionally for one employee). */
export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const employeeId = new URL(req.url).searchParams.get("employeeId") ?? undefined;
    const advances = await listAdvances(session.tenantId, employeeId);
    return NextResponse.json({ advances }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "list advances failed");
    return problem(500, "List failed", "Could not list advances");
  }
}

/** Request a salary advance within the employee's eligible limit. ADMIN only. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const parsed = advanceRequestInput.safeParse(await req.json());
    if (!parsed.success) {
      return problem(400, "Invalid input", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const advance = await requestAdvance(session.tenantId, session.id, parsed.data);
    return NextResponse.json({ advance }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "request advance failed");
    return problem(500, "Request failed", "Could not request the advance");
  }
}

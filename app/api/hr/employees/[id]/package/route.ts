import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { setPackage, packageInput } from "@/lib/hr/employees";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Set a new effective-dated compensation package (supersedes the current one). ADMIN only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const { id } = await ctx.params;

    const parsed = packageInput.safeParse(await req.json());
    if (!parsed.success) {
      return problem(400, "Invalid input", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const employee = await setPackage(session.tenantId, id, session.id, parsed.data);
    return NextResponse.json({ employee }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "set package failed");
    return problem(500, "Update failed", "Could not update the package");
  }
}

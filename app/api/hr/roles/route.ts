import "server-only";

import { NextResponse } from "next/server";

import { requireSession, requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { createRole, listRoles, roleInput } from "@/lib/hr/employees";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List the tenant's roles. */
export async function GET() {
  try {
    const session = await requireSession();
    const roles = await listRoles(session.tenantId);
    return NextResponse.json({ roles }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "list roles failed");
    return problem(500, "List failed", "Could not list roles");
  }
}

/** Create a tenant role. ADMIN only. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);

    const parsed = roleInput.safeParse(await req.json());
    if (!parsed.success) {
      return problem(400, "Invalid input", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const role = await createRole(session.tenantId, parsed.data);
    return NextResponse.json({ role }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "create role failed");
    return problem(500, "Create failed", "Could not create the role");
  }
}

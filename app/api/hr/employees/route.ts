import "server-only";

import { NextResponse } from "next/server";

import { requireSession, requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { listEmployees, onboardEmployee, onboardInput } from "@/lib/hr/employees";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List the tenant's employees. */
export async function GET() {
  try {
    const session = await requireSession();
    const employees = await listEmployees(session.tenantId);
    return NextResponse.json({ employees }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "list employees failed");
    return problem(500, "List failed", "Could not list employees");
  }
}

/** Onboard a new employee (identity, role, salary, package). ADMIN only. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);

    const parsed = onboardInput.safeParse(await req.json());
    if (!parsed.success) {
      return problem(400, "Invalid input", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const employee = await onboardEmployee(session.tenantId, session.id, parsed.data);
    return NextResponse.json({ employee }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "onboard employee failed");
    return problem(500, "Onboard failed", "Could not onboard the employee");
  }
}

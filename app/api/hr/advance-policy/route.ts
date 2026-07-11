import "server-only";

import { NextResponse } from "next/server";

import { requireSession, requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { getAdvancePolicy, setAdvancePolicy, advancePolicyInput } from "@/lib/hr/advances";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read the tenant's advance policy (defaults if unset). */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ policy: await getAdvancePolicy(session.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "get advance policy failed");
    return problem(500, "Fetch failed", "Could not fetch the advance policy");
  }
}

/** Set the tenant's advance policy. ADMIN only. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const parsed = advancePolicyInput.safeParse(await req.json());
    if (!parsed.success) {
      return problem(400, "Invalid input", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const policy = await setAdvancePolicy(session.tenantId, parsed.data);
    return NextResponse.json({ policy }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "set advance policy failed");
    return problem(500, "Update failed", "Could not update the advance policy");
  }
}

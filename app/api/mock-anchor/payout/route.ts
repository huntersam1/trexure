import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { problem, AppError } from "@/lib/http/problem";
import { mockPayoutSchema } from "@/lib/validation/webhooks";
import { triggerMockPayout } from "@/lib/anchor/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Gate FIRST: when disabled the feature does not exist (404, no session probe).
  if (!env.ENABLE_MOCK_ANCHOR) {
    return problem(404, "Not Found", "Mock anchor is disabled");
  }
  try {
    await requireSession();
    assertCsrf(req); // state-changing POST — double-submit + origin (#143)
    const body = await req.json().catch(() => null);
    const parsed = mockPayoutSchema.safeParse(body);
    if (!parsed.success) {
      return problem(400, "Bad Request", "Invalid payout request");
    }
    const result = await triggerMockPayout(parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    if (e instanceof AppError) return problem(e.status, e.title, e.detail);
    throw e;
  }
}

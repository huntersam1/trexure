import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { forTenant } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { problem, AppError } from "@/lib/http/problem";
import { mockPayoutSchema } from "@/lib/validation/webhooks";
import { triggerMockPayout } from "@/lib/anchor/mock";
import { sweepOut } from "@/lib/yield/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Gate FIRST: when disabled the feature does not exist (404, no session probe).
  if (!env.ENABLE_MOCK_ANCHOR) {
    return problem(404, "Not Found", "Mock anchor is disabled");
  }
  try {
    const user = await requireSession();
    assertCsrf(req); // state-changing POST — double-submit + origin (#143)
    const body = await req.json().catch(() => null);
    const parsed = mockPayoutSchema.safeParse(body);
    if (!parsed.success) {
      return problem(400, "Bad Request", "Invalid payout request");
    }

    // Treasury Float Yield (#161 P3): this payout IS the disbursement trigger, so
    // unwind any yield position back to liquid USDC first. Flag-gated (default off
    // → no-op) and liquidity-sacred — sweepOut never throws; on a failed unwind it
    // flags the position + alerts and the payout still proceeds from the buffer.
    if (env.ENABLE_YIELD) {
      const payment = await forTenant(user.tenantId).payment.findFirst({
        where: { intentId: parsed.data.intentId },
        select: { id: true },
      });
      if (payment) await sweepOut(user.tenantId, payment.id);
    }

    const result = await triggerMockPayout(parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    if (e instanceof AppError) return problem(e.status, e.title, e.detail);
    throw e;
  }
}

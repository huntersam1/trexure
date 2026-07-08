import { NextResponse } from "next/server";

import { requireReceiver } from "@/lib/receiver/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { submitClaim } from "@/lib/receiver/claim";
import { claimSchema } from "@/lib/validation/pool";
import { problem, AppError } from "@/lib/http/problem";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic"; // never cache authenticated data

/**
 * Receiver claim endpoint (P3, #85). Auth is the RECEIVER session (not the
 * tenant `User` session), so a tenant user cannot claim and vice-versa. Gated
 * behind ENABLE_POOL_RAIL. This phase validates + dispatches; the wallet/bank
 * payout execution is stubbed (P4 #86 / P5 #87) and returns 501 until wired.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.ENABLE_POOL_RAIL) {
    return problem(404, "Not Found", "The private on-chain transfer rail is disabled");
  }
  try {
    const receiver = await requireReceiver();
    assertCsrf(req);

    const json = await req.json().catch(() => null);
    const parsed = claimSchema.safeParse(json);
    if (!parsed.success) {
      return problem(422, "Invalid claim", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await submitClaim(receiver.id, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not process the claim");
  }
}

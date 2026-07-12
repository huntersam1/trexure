import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { enforceRateLimit } from "@/lib/auth/rate-limit";
import { createPoolWithdraw } from "@/lib/pool/service";
import { poolWithdrawSchema } from "@/lib/validation/pool";
import { problem, AppError } from "@/lib/http/problem";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Claim a pool note (P6, #65): build the Groth16 proof + pay `recipient` from the
 * pool, unlinkable to the deposit. Server-relayed for the demo. 404 when the rail
 * is off.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.ENABLE_POOL_RAIL) {
    return problem(404, "Not Found", "The private on-chain transfer rail is disabled");
  }
  try {
    const session = await requireSession();
    assertCsrf(req);
    // Groth16 proof + real testnet withdraw — throttle per tenant (#143).
    const limited = await enforceRateLimit(`pool-withdraw:${session.tenantId}`, { limit: 15, windowSec: 60 });
    if (limited) return limited;

    const json = await req.json().catch(() => null);
    const parsed = poolWithdrawSchema.safeParse(json);
    if (!parsed.success) {
      return problem(422, "Invalid claim", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await createPoolWithdraw(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not submit the withdrawal");
  }
}

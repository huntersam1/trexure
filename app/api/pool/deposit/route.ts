import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { enforceRateLimit } from "@/lib/auth/rate-limit";
import { createPoolDeposit } from "@/lib/pool/service";
import { poolDepositSchema } from "@/lib/validation/pool";
import { problem, AppError } from "@/lib/http/problem";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic"; // never cache authenticated/tenant data

/**
 * Shield XLM into the pool (P6, #65). Server-signed (demo): the server source
 * account deposits and the response carries the one-time note — the ONLY way to
 * claim the funds later. Gated behind ENABLE_POOL_RAIL (404 when off).
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.ENABLE_POOL_RAIL) {
    return problem(404, "Not Found", "The private on-chain transfer rail is disabled");
  }
  try {
    const session = await requireSession();
    assertCsrf(req);
    // Real testnet deposit — throttle per tenant (#143).
    const limited = await enforceRateLimit(`pool-deposit:${session.tenantId}`, { limit: 15, windowSec: 60 });
    if (limited) return limited;

    const json = await req.json().catch(() => null);
    const parsed = poolDepositSchema.safeParse(json);
    if (!parsed.success) {
      return problem(422, "Invalid deposit", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await createPoolDeposit(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not submit the deposit");
  }
}

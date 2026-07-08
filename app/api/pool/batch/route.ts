import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { createPoolBatch } from "@/lib/pool/batch";
import { poolBatchSchema } from "@/lib/validation/pool";
import { problem, AppError } from "@/lib/http/problem";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic"; // never cache authenticated/tenant data

/**
 * Batch send (P2, #84): submit N receivers → N pool deposits → N claimable
 * notes, each persisted as a child `Payment` under a `PaymentBatch`. Server-
 * signed (demo). Gated behind ENABLE_POOL_RAIL (404 when off). Email delivery
 * of the notes is out of scope (#81/#82) — the response echoes them once.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.ENABLE_POOL_RAIL) {
    return problem(404, "Not Found", "The private on-chain transfer rail is disabled");
  }
  try {
    const session = await requireSession();
    assertCsrf(req);

    const json = await req.json().catch(() => null);
    const parsed = poolBatchSchema.safeParse(json);
    if (!parsed.success) {
      return problem(422, "Invalid batch", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await createPoolBatch(session.tenantId, session.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not submit the batch");
  }
}

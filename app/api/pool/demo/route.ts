import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { runPoolDemo } from "@/lib/pool/demo";
import { poolDemoSchema } from "@/lib/validation/pool";
import { problem, AppError } from "@/lib/http/problem";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * One-click pool demo (P6, #65): deposit → withdraw to a fresh address in a
 * single call, for the pitch. Server-signed. 404 when the rail is off.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.ENABLE_POOL_RAIL) {
    return problem(404, "Not Found", "The private on-chain transfer rail is disabled");
  }
  try {
    await requireSession();
    assertCsrf(req);

    const json = await req.json().catch(() => ({}));
    const parsed = poolDemoSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return problem(422, "Invalid demo request", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await runPoolDemo(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "The pool demo could not complete");
  }
}

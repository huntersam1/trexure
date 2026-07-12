import { NextResponse } from "next/server";
import { requireSession } from "../../../lib/auth/session";
import { assertCsrf } from "../../../lib/auth/csrf";
import { createPayment, listPayments } from "../../../lib/payments/service";
import { createPaymentSchema, listPaymentsQuerySchema } from "../../../lib/validation/payments";
import { reserveIdempotent, setCachedIdempotent, releaseIdempotent, IDEM_PENDING } from "../../../lib/idempotency";
import { problem, AppError } from "../../../lib/http/problem";
import { env } from "../../../lib/env";

export const dynamic = "force-dynamic"; // never cache authenticated/tenant data

export async function POST(req: Request): Promise<Response> {
  // Gate FIRST (mirrors the mock-anchor route): while the shielded transfer
  // contract isn't live, submission is a clear 503, never an unhandled 500 (#32).
  if (!env.ENABLE_NEW_PAYMENTS) {
    return problem(
      503,
      "New payments unavailable",
      "New payment submission is disabled while the shielded transfer contract is being deployed. Existing payments and the Demo Replay are unaffected.",
    );
  }
  try {
    const user = await requireSession();
    assertCsrf(req);

    const json = await req.json().catch(() => null);
    const parsed = createPaymentSchema.safeParse(json);
    if (!parsed.success) {
      return problem(422, "Invalid payment", parsed.error.issues.map((i) => i.message).join("; "));
    }

    const idemKey = req.headers.get("idempotency-key");
    const scope = `payments:${user.tenantId}`;

    // Reserve the key ATOMICALLY before submitting (#143). Two concurrent
    // requests with the same key can't both reach createPayment: exactly one
    // wins the SET NX; the loser returns the finalized id (200) or, if the
    // winner is still in flight, 409 to retry.
    if (idemKey) {
      const { reserved, existing } = await reserveIdempotent(scope, idemKey);
      if (!reserved) {
        if (existing && existing !== IDEM_PENDING) {
          return NextResponse.json({ id: existing, status: "PENDING", idempotent: true }, { status: 200 });
        }
        return problem(409, "In progress", "A payment with this Idempotency-Key is already being processed. Retry shortly.");
      }
    }

    let result;
    try {
      result = await createPayment(user.tenantId, parsed.data);
    } catch (workErr) {
      // Release the reservation so a legitimate retry isn't locked out.
      if (idemKey) await releaseIdempotent(scope, idemKey);
      throw workErr;
    }

    if (idemKey) {
      await setCachedIdempotent(scope, idemKey, result.id);
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not create payment");
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const parsed = listPaymentsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return problem(422, "Invalid query", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const page = await listPayments(user.tenantId, parsed.data);
    return NextResponse.json(page, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not list payments");
  }
}

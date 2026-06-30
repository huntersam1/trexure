import { NextResponse } from "next/server";
import { requireSession } from "../../../lib/auth/session";
import { assertCsrf } from "../../../lib/auth/csrf";
import { createPayment, listPayments } from "../../../lib/payments/service";
import { createPaymentSchema, listPaymentsQuerySchema } from "../../../lib/validation/payments";
import { getCachedIdempotent, setCachedIdempotent } from "../../../lib/idempotency";
import { problem, AppError } from "../../../lib/http/problem";

export const dynamic = "force-dynamic"; // never cache authenticated/tenant data

export async function POST(req: Request): Promise<Response> {
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

    if (idemKey) {
      const cachedId = await getCachedIdempotent(scope, idemKey);
      if (cachedId) {
        return NextResponse.json({ id: cachedId, status: "PENDING", idempotent: true }, { status: 200 });
      }
    }

    const result = await createPayment(user.tenantId, parsed.data);

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

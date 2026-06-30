import { NextResponse } from "next/server";
import { requireSession } from "../../../../../lib/auth/session";
import { assertCsrf } from "../../../../../lib/auth/csrf";
import { enqueueReconcile } from "../../../../../lib/payments/service";
import { problem, AppError } from "../../../../../lib/http/problem";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireSession();
    assertCsrf(req);
    const { id } = await ctx.params;
    await enqueueReconcile(user.tenantId, id);
    return NextResponse.json({ status: "enqueued", paymentId: id }, { status: 202 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not re-enqueue reconcile");
  }
}

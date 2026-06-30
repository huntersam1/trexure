import { NextResponse } from "next/server";
import { requireSession } from "../../../../lib/auth/session";
import { getPaymentById } from "../../../../lib/payments/service";
import { problem, AppError } from "../../../../lib/http/problem";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireSession();
    const { id } = await ctx.params; // Next.js 16: params is async
    const payment = await getPaymentById(user.tenantId, id);
    return NextResponse.json(payment, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal error", "Could not load payment");
  }
}

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { resetSamplePayment } from "@/lib/demo/reset";
import { demoResetParamsSchema } from "@/lib/validation/demo";
import { problem, AppError } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertCsrf(req);
    const user = await requireSession();
    const { id } = demoResetParamsSchema.parse(await ctx.params);
    const out = await resetSamplePayment(user.tenantId, id);
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(400, "Bad Request", "Invalid demo reset request");
  }
}

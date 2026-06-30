import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { resolveApiKey } from "@/lib/auth/api-key";
import { forTenant } from "@/lib/db";
import { problem } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  let tenantId: string | null = null;
  const session = await getSessionUser();
  if (session) {
    tenantId = session.tenantId;
  } else {
    const auth = req.headers.get("authorization") ?? "";
    if (auth.startsWith("Bearer ")) {
      const resolved = await resolveApiKey(auth.slice("Bearer ".length).trim());
      tenantId = resolved?.tenantId ?? null;
    }
  }
  if (!tenantId) {
    return problem(401, "Unauthorized", "A session or API key is required.");
  }

  const db = forTenant(tenantId);
  const payment = await db.payment.findUnique({
    where: { id },
    include: { receipt: true },
  });
  if (!payment || !payment.receipt) {
    return problem(404, "Not Found", "Receipt not found.");
  }

  return NextResponse.json(payment.receipt.json, {
    headers: { "cache-control": "no-store" },
  });
}

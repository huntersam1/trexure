import "server-only";

import { z } from "zod";
import { NextResponse } from "next/server";

import { requireSession, requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { requestConversion, listConversions, conversionRequestInput } from "@/lib/hr/conversions";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestBody = conversionRequestInput.extend({ employeeId: z.string().trim().min(1) });

/** List conversions (optionally for one employee). */
export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const employeeId = new URL(req.url).searchParams.get("employeeId") ?? undefined;
    const conversions = await listConversions(session.tenantId, employeeId);
    return NextResponse.json({ conversions }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "list conversions failed");
    return problem(500, "List failed", "Could not list conversions");
  }
}

/** Request a conversion of a convertible package item into cash. ADMIN only. */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);

    const parsed = requestBody.safeParse(await req.json());
    if (!parsed.success) {
      return problem(400, "Invalid input", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { employeeId, ...conv } = parsed.data;
    const conversion = await requestConversion(session.tenantId, employeeId, session.id, conv);
    return NextResponse.json({ conversion }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "request conversion failed");
    return problem(500, "Request failed", "Could not request the conversion");
  }
}

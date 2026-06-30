import { NextResponse } from "next/server";
import { requireSession, destroySession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { problem, AppError } from "@/lib/http/problem";

export async function POST(req: Request): Promise<Response> {
  try {
    await requireSession();
    assertCsrf(req);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    throw err;
  }
}

import { NextResponse } from "next/server";
import { signupSchema } from "@/lib/validation/auth";
import { completeSignup, SIGNUP_RATE_LIMIT, signupRateLimitKey } from "@/lib/auth/signup";
import { rateLimit } from "@/lib/auth/rate-limit";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return problem(400, "Bad Request", "Request body must be valid JSON.");
  }

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return problem(422, "Invalid signup", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const ipLimit = await rateLimit(signupRateLimitKey(ip), SIGNUP_RATE_LIMIT);
  if (!ipLimit.allowed) {
    const res = problem(429, "Too Many Requests", "Too many signup attempts. Try again later.");
    res.headers.set("Retry-After", String(ipLimit.retryAfterSec));
    return res;
  }

  try {
    const provisioned = await completeSignup(parsed.data, ip, req.headers.get("user-agent") ?? undefined);

    return NextResponse.json(
      { ok: true, tenantId: provisioned.tenantId, samplePaymentId: provisioned.samplePaymentId },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn({ ip, status: err.status }, "auth.signup.rejected"); // never log username
      return problem(err.status, err.title, err.detail);
    }
    logger.error({ err }, "auth.signup.failed");
    return problem(500, "Internal error", "Could not create the account.");
  }
}

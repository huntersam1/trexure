import { NextResponse } from "next/server";
import { signupSchema } from "@/lib/validation/auth";
import { prisma } from "@/lib/db";
import { provisionTenant } from "@/lib/auth/signup";
import { createSession } from "@/lib/auth/session";
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

  // Tenant provisioning is expensive — throttle harder than login (per-IP only;
  // per-username would leak which usernames exist before the create runs).
  const ipLimit = await rateLimit(`signup:ip:${ip}`, { limit: 5, windowSec: 3600 });
  if (!ipLimit.allowed) {
    const res = problem(429, "Too Many Requests", "Too many signup attempts. Try again later.");
    res.headers.set("Retry-After", String(ipLimit.retryAfterSec));
    return res;
  }

  try {
    const provisioned = await provisionTenant(parsed.data);

    await createSession(provisioned.userId, ip, req.headers.get("user-agent") ?? undefined);
    await prisma.auditLog.create({
      data: {
        tenantId: provisioned.tenantId,
        userId: provisioned.userId,
        action: "auth.signup",
        ip,
      },
    });
    logger.info({ tenantId: provisioned.tenantId, ip }, "auth.signup.success");

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

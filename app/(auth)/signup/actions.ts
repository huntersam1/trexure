"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { issueCsrfToken, CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { provisionTenant } from "@/lib/auth/signup";
import { rateLimit } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db";
import { signupSchema } from "@/lib/validation/auth";
import { AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export type SignupState = { error: string | null; fieldErrors?: Record<string, string> };

function assertSameOrigin(h: Headers): boolean {
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") return false;
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const h = await headers();
  if (!assertSameOrigin(h)) return { error: "Could not create the account." };
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const parsed = signupSchema.safeParse({
    tenantName: formData.get("tenantName"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  // Same throttle as POST /api/auth/signup — provisioning is expensive.
  const ipLimit = await rateLimit(`signup:ip:${ip}`, { limit: 5, windowSec: 3600 });
  if (!ipLimit.allowed) return { error: "Too many signup attempts. Try again later." };

  let provisioned;
  try {
    provisioned = await provisionTenant(parsed.data);
  } catch (err) {
    if (err instanceof AppError) return { error: err.detail ?? err.title };
    logger.error({ err }, "auth.signup.failed");
    return { error: "Could not create the account." };
  }

  await createSession(provisioned.userId, ip, h.get("user-agent") ?? undefined);
  await prisma.auditLog.create({
    data: { tenantId: provisioned.tenantId, userId: provisioned.userId, action: "auth.signup", ip },
  });
  logger.info({ tenantId: provisioned.tenantId, ip }, "auth.signup.success");

  // Seed the double-submit CSRF cookie exactly like the login action, so
  // authenticated client mutations can echo it in the x-csrf-token header.
  const store = await cookies();
  store.set(CSRF_COOKIE_NAME, issueCsrfToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  redirect("/");
}

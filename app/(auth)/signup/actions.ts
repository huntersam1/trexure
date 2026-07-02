"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { issueCsrfToken, CSRF_COOKIE_NAME, assertSameOrigin } from "@/lib/auth/csrf";
import { completeSignup, SIGNUP_RATE_LIMIT, signupRateLimitKey } from "@/lib/auth/signup";
import { rateLimit } from "@/lib/auth/rate-limit";
import { signupSchema } from "@/lib/validation/auth";
import { AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export type SignupState = { error: string | null; fieldErrors?: Record<string, string> };

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

  const ipLimit = await rateLimit(signupRateLimitKey(ip), SIGNUP_RATE_LIMIT);
  if (!ipLimit.allowed) return { error: "Too many signup attempts. Try again later." };

  try {
    await completeSignup(parsed.data, ip, h.get("user-agent") ?? undefined);
  } catch (err) {
    if (err instanceof AppError) return { error: err.detail ?? err.title };
    logger.error({ err }, "auth.signup.failed");
    return { error: "Could not create the account." };
  }

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

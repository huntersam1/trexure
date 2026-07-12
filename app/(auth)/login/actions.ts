"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { verifyPassword, getDummyHash } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { issueCsrfToken, CSRF_COOKIE_NAME, assertSameOrigin } from "@/lib/auth/csrf";
import { prisma } from "@/lib/db";
import { loginFormSchema } from "@/lib/validation/payment-ui";

export type LoginState = { error: string | null };

const GENERIC = "Invalid username or password.";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const h = await headers();
  if (!assertSameOrigin(h)) return { error: GENERIC };

  const parsed = loginFormSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC };
  const { username, password } = parsed.data;

  // Same protections as the /api/auth/login route (#143): throttle per-IP and
  // per-username, and always run a verify (real or dummy hash) so an unknown
  // username can't be told apart by response timing.
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(`login:ip:${ip}`, { limit: 10, windowSec: 300 }),
    rateLimit(`login:user:${username}`, { limit: 5, windowSec: 300 }),
  ]);
  if (!ipLimit.allowed || !userLimit.allowed) {
    return { error: "Too many login attempts. Please try again later." };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !ok) return { error: GENERIC };

  await createSession(user.id, h.get("x-forwarded-for") ?? undefined, h.get("user-agent") ?? undefined);

  // Seed the double-submit CSRF cookie so authenticated client mutations
  // (e.g. POST /api/payments/[id]/decrypt) can echo it in the x-csrf-token
  // header. Pages read this cookie server-side and pass the token to clients.
  const store = await cookies();
  store.set(CSRF_COOKIE_NAME, issueCsrfToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  redirect("/");
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { issueCsrfToken, CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { prisma } from "@/lib/db";
import { loginFormSchema } from "@/lib/validation/payment-ui";

export type LoginState = { error: string | null };

const GENERIC = "Invalid username or password.";

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

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const h = await headers();
  if (!assertSameOrigin(h)) return { error: GENERIC };

  const parsed = loginFormSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC };

  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  const ok = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
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

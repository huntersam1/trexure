"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { createReceiverSession } from "@/lib/receiver/session";
import { registerReceiver, verifyReceiverCredentials } from "@/lib/receiver/auth";
import { issueCsrfToken, CSRF_COOKIE_NAME, assertSameOrigin } from "@/lib/auth/csrf";
import { AppError } from "@/lib/http/problem";
import { sanitizeNext } from "@/lib/receiver/safe-next";
import { receiverLoginSchema, receiverRegisterSchema } from "@/lib/validation/receiver";

export type ReceiverAuthState = { error: string | null };

const GENERIC = "Invalid email or password.";

/**
 * One server action for both login and register (branch on the hidden `intent`
 * field), mirroring the tenant login action's same-origin + CSRF-cookie seeding.
 * On success it opens a receiver session and lands on /claim.
 */
export async function receiverAuthAction(
  _prev: ReceiverAuthState,
  formData: FormData,
): Promise<ReceiverAuthState> {
  const h = await headers();
  if (!assertSameOrigin(h)) return { error: GENERIC };

  const intent = formData.get("intent");
  const next = sanitizeNext(formData.get("next")?.toString());
  const raw = { email: formData.get("email"), password: formData.get("password") };

  let receiverId: string;
  try {
    if (intent === "register") {
      const parsed = receiverRegisterSchema.safeParse(raw);
      if (!parsed.success) {
        return { error: parsed.error.issues[0]?.message ?? GENERIC };
      }
      const created = await registerReceiver(parsed.data.email, parsed.data.password);
      receiverId = created.id;
    } else {
      const parsed = receiverLoginSchema.safeParse(raw);
      if (!parsed.success) return { error: GENERIC };
      const ok = await verifyReceiverCredentials(parsed.data.email, parsed.data.password);
      if (!ok) return { error: GENERIC };
      receiverId = ok.id;
    }
  } catch (err) {
    if (err instanceof AppError) return { error: err.detail ?? err.title };
    throw err;
  }

  await createReceiverSession(
    receiverId,
    h.get("x-forwarded-for") ?? undefined,
    h.get("user-agent") ?? undefined,
  );

  // Seed the double-submit CSRF cookie so the authenticated claim POST can echo
  // it in the x-csrf-token header (same mechanism as the tenant login).
  const store = await cookies();
  store.set(CSRF_COOKIE_NAME, issueCsrfToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  redirect(next as Route);
}

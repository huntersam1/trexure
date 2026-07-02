"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { issueCsrfToken, forwardedCookieHeader } from "@/lib/auth/csrf";
import { env } from "@/lib/env";
import { createPaymentFormSchema } from "@/lib/validation/payment-ui";

export type CreateState = { error: string | null; fieldErrors?: Record<string, string> };

export async function createPaymentAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  await requireSession(); // throws AppError(401) -> rendered by error boundary if unauthenticated
  void (await headers());

  const parsed = createPaymentFormSchema.safeParse({
    recipientRef: formData.get("recipientRef"),
    amount: formData.get("amount"),
    sourceAsset: formData.get("sourceAsset"),
    targetCurrency: formData.get("targetCurrency"),
    anchorId: formData.get("anchorId"),
    memo: formData.get("memo") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  // Call the documented Phase 3 route handler so the Soroban submit + enqueue path runs.
  // The fresh CSRF token is sent as BOTH the double-submit cookie (the route's
  // assertCsrf reads __Host-trexure_csrf) and the x-csrf-token header; the jar's
  // login-time CSRF cookie is dropped so the name isn't duplicated (#29).
  const csrf = issueCsrfToken();
  const cookieHeader = forwardedCookieHeader((await cookies()).getAll(), csrf);
  const res = await fetch(`${env.APP_URL}/api/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf,
      origin: env.APP_URL,
      cookie: cookieHeader,
    },
    body: JSON.stringify(parsed.data),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
    return { error: body.detail ?? body.title ?? "Could not submit payment." };
  }

  const { id } = (await res.json()) as { id: string };
  redirect(`/payments/${id}`);
}

import "server-only";

import { env } from "@/lib/env";
import { AppError } from "@/lib/http/problem";
import { mockEmailProvider } from "./mock";

/**
 * Email provider seam (#81). Mirrors the anchor `mock|real` toggle: batch claim
 * emails go through this interface, selected by `EMAIL_PROVIDER`, so CI stays
 * offline on the mock and a real provider drops in without touching callers.
 */
export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type EmailSendResult = { id: string };

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Real-provider placeholder. Kept behind the interface and selectable by
 * `EMAIL_PROVIDER=resend` so the wiring is proven, but sending throws until a
 * concrete client (Resend/SES/Postmark — API key + templating + deliverability)
 * is implemented. Deliberately not wired here — that's a follow-up.
 */
const resendEmailProvider: EmailProvider = {
  name: "resend",
  async send() {
    throw new AppError(
      501,
      "Email provider not implemented",
      "The 'resend' email provider is not wired yet; run with EMAIL_PROVIDER=mock.",
    );
  },
};

export function getEmailProvider(): EmailProvider {
  return env.EMAIL_PROVIDER === "resend" ? resendEmailProvider : mockEmailProvider;
}

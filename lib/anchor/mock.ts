import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { signHmac } from "@/lib/webhooks/verify";

/**
 * Mock Anchor: fakes the existence of an external payout provider and the bank
 * payout, but the event it produces is REAL — same Xendit shape, same HMAC over
 * the raw body, POSTed to the real /api/webhooks/fiat. Mock the provider, never
 * the verification path. Gated upstream by ENABLE_MOCK_ANCHOR.
 */
export async function triggerMockPayout(args: {
  intentId: string;
  amount: string;
  currency: string;
  recipientRef: string;
  delayMs?: number;
  fail?: boolean;
}): Promise<{ providerRef: string; bankRef: string; status: "completed" | "failed" }> {
  const status: "completed" | "failed" = args.fail ? "failed" : "completed";
  const providerRef = `mock_payout_${randomBytes(8).toString("hex")}`;
  const bankRef = `PH-BANK-${randomBytes(4).toString("hex").toUpperCase()}`;

  // Invented FX/fee figures (deterministic for the demo corridor).
  const fxRate = "56.70";
  const anchorFee = "50.00";

  const event = {
    id: `evt_mock_${randomBytes(8).toString("hex")}`,
    event: args.fail ? "payment.failed" : "payment.completed",
    intentId: args.intentId,
    providerRef,
    bankRef,
    amount: args.amount,
    currency: args.currency,
    fxRate,
    anchorFee,
    createdAt: new Date().toISOString(),
  };

  const rawBody = JSON.stringify(event);
  const secret = process.env.XENDIT_CALLBACK_TOKEN ?? env.ANCHOR_CALLBACK_TOKEN;
  const signature = signHmac(rawBody, secret);

  const delayMs = args.delayMs ?? 1500;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  await fetch(new URL("/api/webhooks/fiat", env.APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-callback-token": signature },
    body: rawBody,
  });

  return { providerRef, bankRef, status };
}

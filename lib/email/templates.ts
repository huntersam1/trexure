import type { EmailMessage } from "./provider";

/**
 * Branded claim email (#81). Deliberately carries NO note — only the amount,
 * payer, and a single call-to-action to the auth-gated claim link. The note is
 * revealed behind receiver auth after they follow the link (see
 * `lib/receiver/claim-link.ts`), so a usable bearer credential never lands in an
 * inbox or mail log.
 */
export function buildClaimEmail(args: {
  to: string;
  payerName: string;
  amount: string;
  asset: string;
  claimUrl: string;
}): EmailMessage {
  const { to, payerName, amount, asset, claimUrl } = args;
  const payer = payerName || "a Trexure workspace";
  const subject = `You have a ${amount} ${asset} payment to claim`;

  const text = [
    `${payer} sent you a private payment of ${amount} ${asset}.`,
    ``,
    `Claim it securely here (you'll sign in first — the payment details are`,
    `revealed only to you, after you log in):`,
    claimUrl,
    ``,
    `This link is private — don't forward it. It expires in 14 days.`,
    ``,
    `— Trexure`,
  ].join("\n");

  const html = [
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#111">`,
    `<h2 style="margin:0 0 4px">Trexure</h2>`,
    `<p style="color:#555;margin:0 0 20px">You have a payment to claim</p>`,
    `<p><strong>${payer}</strong> sent you a private payment of <strong>${amount} ${asset}</strong>.</p>`,
    `<p style="margin:24px 0">`,
    `<a href="${claimUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:700">Claim your payment</a>`,
    `</p>`,
    `<p style="color:#555;font-size:14px">You'll sign in first — the payment details are revealed only to you, after you log in. This link is private (don't forward it) and expires in 14 days.</p>`,
    `</div>`,
  ].join("");

  return { to, subject, html, text };
}

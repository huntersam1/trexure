import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/log";
import { problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/auth/rate-limit";
import { verifyHmac } from "@/lib/webhooks/verify";
import { loadAnchorWebhookSecret } from "@/lib/anchor/secret";
import { fiatWebhookSchema } from "@/lib/validation/webhooks";
import { QUEUE, reconcileQueue } from "@/lib/queue";
import type { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}

function ack(detail: string): Response {
  return NextResponse.json({ received: true, detail }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`webhook:fiat:${ip}`, { limit: 120, windowSec: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { received: false },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  // 1) RAW body BEFORE parse — exact bytes for HMAC.
  const rawBody = await req.text();
  const signature = req.headers.get("x-callback-token") ?? "";

  // 2) Parse + validate (best-effort, even when unverified, for the admin log).
  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  const parsed = fiatWebhookSchema.safeParse(json);
  const provider = env.ANCHOR_PROVIDER;

  // 2a) Resolve the verification key from the REFERENCED payment's tenant (#143
  // H1). The per-tenant AnchorConfig.webhookSecret is authoritative — a global
  // token can no longer forge events for a tenant that set its own secret. Fall
  // back to the global env token for unconfigured tenants / unmatched events so
  // the demo + first-boot keep working. (A read on untrusted input, no mutation.)
  const payment = parsed.success
    ? await prisma.payment.findUnique({ where: { intentId: parsed.data.intentId } })
    : null;
  const tenantSecret = payment ? await loadAnchorWebhookSecret(payment.tenantId, provider) : null;
  const secret = tenantSecret ?? env.XENDIT_CALLBACK_TOKEN ?? env.ANCHOR_CALLBACK_TOKEN;
  const verified = verifyHmac(rawBody, signature, secret);

  // 3) Unverified → log for admin review, NEVER create a leg, reject 401.
  if (!verified) {
    const externalId = parsed.success ? parsed.data.id : `unverified_${Date.now()}`;
    await prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider, externalId } },
      create: { provider, externalId, verified: false, payload: (json ?? {}) as object },
      update: {},
    });
    logger.warn({ provider, externalId, ip }, "fiat webhook: HMAC verification failed");
    return problem(401, "Unauthorized", "Invalid webhook signature");
  }

  if (!parsed.success) {
    logger.warn({ provider, ip }, "fiat webhook: verified but schema invalid");
    return problem(400, "Bad Request", "Invalid webhook payload");
  }
  const evt = parsed.data;

  // 4) Idempotency: first verified write wins; duplicate externalId → no-op 2xx.
  try {
    await prisma.webhookEvent.create({
      data: { provider, externalId: evt.id, verified: true, payload: evt },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      logger.info({ provider, externalId: evt.id }, "fiat webhook: duplicate, no-op");
      return ack("duplicate");
    }
    throw e;
  }

  // 5) The payment was located up front (step 2a) to resolve the tenant secret.
  if (!payment) {
    logger.warn({ provider, intentId: evt.intentId }, "fiat webhook: no matching payment");
    await prisma.webhookEvent.update({
      where: { provider_externalId: { provider, externalId: evt.id } },
      data: { processedAt: new Date() },
    });
    return ack("no matching payment");
  }

  // 6) Idempotent FIAT leg via (paymentId, legType) unique.
  const legStatus = evt.event === "payment.completed" ? "RECEIVED" : "FAILED";
  // `satisfies` gives the literal `status` a contextual type so it isn't widened
  // to `string` (object-literal widening) and matches the Prisma `LegStatus` enum.
  const legData = {
    provider,
    providerRef: evt.providerRef,
    bankRef: evt.bankRef,
    amount: evt.amount,
    currency: evt.currency,
    receivedAt: new Date(),
    status: legStatus,
  } satisfies Prisma.PaymentLegUncheckedUpdateInput;
  await prisma.paymentLeg.upsert({
    where: { paymentId_legType: { paymentId: payment.id, legType: "FIAT" } },
    create: { paymentId: payment.id, legType: "FIAT", ...legData },
    update: legData,
  });

  if (evt.event === "payment.failed") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
  }

  await prisma.webhookEvent.update({
    where: { provider_externalId: { provider, externalId: evt.id } },
    data: { processedAt: new Date() },
  });

  // 7) Hand heavy matching to the worker; respond fast.
  await reconcileQueue.add(
    QUEUE.RECONCILE,
    { paymentId: payment.id },
    { jobId: `reconcile:${payment.id}:${evt.id}` },
  );

  return ack("ok");
}

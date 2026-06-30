import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/log";
import { problem } from "@/lib/http/problem";
import { rateLimit } from "@/lib/auth/rate-limit";
import { verifyHmac } from "@/lib/webhooks/verify";
import { chainWebhookSchema } from "@/lib/validation/webhooks";
import { QUEUE, reconcileQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = "chain-indexer";

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
  const rl = await rateLimit(`webhook:chain:${ip}`, { limit: 120, windowSec: 60 });
  if (!rl.allowed) {
    return NextResponse.json(
      { received: false },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-callback-token") ?? "";
  const secret = process.env.CHAIN_WEBHOOK_SECRET ?? env.ANCHOR_CALLBACK_TOKEN;
  const verified = verifyHmac(rawBody, signature, secret);

  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  const parsed = chainWebhookSchema.safeParse(json);

  if (!verified) {
    const externalId = parsed.success ? parsed.data.id : `unverified_${Date.now()}`;
    await prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: PROVIDER, externalId } },
      create: { provider: PROVIDER, externalId, verified: false, payload: (json ?? {}) as object },
      update: {},
    });
    logger.warn({ provider: PROVIDER, externalId, ip }, "chain webhook: HMAC verification failed");
    return problem(401, "Unauthorized", "Invalid webhook signature");
  }

  if (!parsed.success) {
    logger.warn({ provider: PROVIDER, ip }, "chain webhook: verified but schema invalid");
    return problem(400, "Bad Request", "Invalid webhook payload");
  }
  const evt = parsed.data;

  try {
    await prisma.webhookEvent.create({
      data: { provider: PROVIDER, externalId: evt.id, verified: true, payload: evt },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      logger.info({ provider: PROVIDER, externalId: evt.id }, "chain webhook: duplicate, no-op");
      return ack("duplicate");
    }
    throw e;
  }

  const payment = await prisma.payment.findUnique({ where: { intentId: evt.intentId } });
  if (!payment) {
    logger.warn({ provider: PROVIDER, intentId: evt.intentId }, "chain webhook: no matching payment");
    await prisma.webhookEvent.update({
      where: { provider_externalId: { provider: PROVIDER, externalId: evt.id } },
      data: { processedAt: new Date() },
    });
    return ack("no matching payment");
  }

  const legData = {
    status: "CONFIRMED" as const,
    txHash: evt.txHash,
    ledger: evt.ledger,
    contractId: evt.contractId,
  };
  await prisma.paymentLeg.upsert({
    where: { paymentId_legType: { paymentId: payment.id, legType: "ONCHAIN" } },
    create: { paymentId: payment.id, legType: "ONCHAIN", ...legData },
    update: legData,
  });

  if (!payment.proofHash) {
    await prisma.payment.update({ where: { id: payment.id }, data: { proofHash: evt.proofHash } });
  }

  await prisma.webhookEvent.update({
    where: { provider_externalId: { provider: PROVIDER, externalId: evt.id } },
    data: { processedAt: new Date() },
  });

  await reconcileQueue.add(
    QUEUE.RECONCILE,
    { paymentId: payment.id },
    { jobId: `reconcile:${payment.id}:${evt.id}` },
  );

  return ack("ok");
}

import "server-only";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { buildReceipt } from "./receipt";

const D = Prisma.Decimal;
// Realized fiat may deviate from the quoted destination by up to 1% (FX/slippage).
const FX_TOLERANCE = new D("0.01");

export async function tryReconcile(
  paymentId: string,
): Promise<"SETTLED" | "WAITING" | "FAILED"> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { legs: true },
  });
  if (!payment) return "WAITING";

  // Terminal states are idempotent no-ops.
  if (payment.status === "SETTLED") return "SETTLED";
  if (payment.status === "FAILED") return "FAILED";

  const onchain = payment.legs.find((l) => l.legType === "ONCHAIN");
  const fiat = payment.legs.find((l) => l.legType === "FIAT");

  // A failed leg fails the whole payment.
  if (onchain?.status === "FAILED" || fiat?.status === "FAILED") {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } });
    return "FAILED";
  }

  // Intent-id join: both legs are attached to the Payment that the webhook /
  // watch-onchain job resolved from the shared intentId. Require BOTH present.
  if (!onchain || !fiat) return "WAITING";
  if (onchain.status !== "CONFIRMED") return "WAITING";
  if (fiat.status !== "RECEIVED" && fiat.status !== "CONFIRMED") return "WAITING";

  // Corridor must match — never settle on amount alone.
  if (fiat.currency && fiat.currency !== payment.corridorTo) return "WAITING";

  // Amount within FX tolerance: realized fiat vs quoted destination.
  if (payment.targetAmount != null && fiat.amount != null) {
    const quoted = new D(payment.targetAmount.toString());
    const realized = new D(fiat.amount.toString());
    if (quoted.gt(0)) {
      const deviation = quoted.minus(realized).div(quoted).abs();
      if (deviation.gt(FX_TOLERANCE)) return "WAITING";
    }
  }

  // Settle idempotently: only transition out of a non-terminal state.
  const updated = await prisma.payment.updateMany({
    where: { id: paymentId, status: { notIn: ["SETTLED", "FAILED"] } },
    data: { status: "SETTLED" },
  });
  if (updated.count === 0) return "SETTLED"; // concurrently settled

  await buildReceipt(paymentId);
  return "SETTLED";
}

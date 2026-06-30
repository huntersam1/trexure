import "server-only";
import { forTenant } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

/**
 * Idempotent reset of the demo sample payment so Demo Replay can run repeatedly.
 * Deletes the FIAT leg + Receipt, returns status to PENDING, keeps the ONCHAIN leg
 * and the encryptedPayload/proofHash so beats 1–2 stay ready immediately.
 */
export async function resetSamplePayment(
  tenantId: string,
  paymentId: string,
): Promise<{ paymentId: string; status: "PENDING" }> {
  const db = forTenant(tenantId);

  const payment = await db.payment.findFirst({
    where: { id: paymentId },
    include: { legs: true },
  });
  if (!payment) throw new AppError(404, "Payment not found");

  await db.$transaction([
    db.receipt.deleteMany({ where: { paymentId } }),
    db.paymentLeg.deleteMany({ where: { paymentId, legType: "FIAT" } }),
    db.payment.update({
      where: { id: paymentId },
      data: { status: "PENDING", targetAmount: null },
    }),
  ]);

  logger.info({ paymentId, action: "demo.reset" }, "demo sample payment reset");
  return { paymentId, status: "PENDING" };
}

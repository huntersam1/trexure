import { describe, it, expect } from "vitest";
import { tryReconcile } from "../../lib/reconcile/matcher";
import { prisma } from "../../lib/db";
import { seedSampleForTest } from "./helpers";

async function setFiatLeg(paymentId: string, status: "FAILED" | "RECEIVED") {
  await prisma.paymentLeg.upsert({
    where: { paymentId_legType: { paymentId, legType: "FIAT" } },
    update: { status },
    create: { paymentId, legType: "FIAT", status, provider: "mock-anchor", providerRef: "ref", amount: "141750.00000000", currency: "PHP" },
  });
}

async function resetToPending(paymentId: string) {
  await prisma.receipt.deleteMany({ where: { paymentId } });
  await prisma.paymentLeg.deleteMany({ where: { paymentId, legType: "FIAT" } });
  await prisma.payment.update({ where: { id: paymentId }, data: { status: "PENDING" } });
}

describe("failure path then retry", () => {
  it("FAILED fiat leg drives the payment to FAILED; after a reset a RECEIVED leg reconciles to SETTLED", async () => {
    const { paymentId } = await seedSampleForTest();
    await resetToPending(paymentId);

    // Failure path: a FAILED fiat leg fails the whole payment.
    await setFiatLeg(paymentId, "FAILED");
    expect(await tryReconcile(paymentId)).toBe("FAILED");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("FAILED");

    // Recovery: FAILED is TERMINAL in our matcher, so recovery requires a reset
    // (this is exactly what the demo-reset / a fresh payout does). After the reset
    // a RECEIVED fiat leg + the existing CONFIRMED on-chain leg reconcile to SETTLED.
    await resetToPending(paymentId);
    await setFiatLeg(paymentId, "RECEIVED");
    expect(await tryReconcile(paymentId)).toBe("SETTLED");

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe("SETTLED");
  });
});

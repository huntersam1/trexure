import { describe, it, expect, beforeEach } from "vitest";
import { resetSamplePayment } from "../../lib/demo/reset";
import { prisma } from "../../lib/db";
import { seedSampleForTest } from "./helpers"; // creates tenant + sample payment w/ fiat leg + receipt

describe("resetSamplePayment", () => {
  let tenantId: string;
  let paymentId: string;

  beforeEach(async () => {
    ({ tenantId, paymentId } = await seedSampleForTest());
  });

  it("removes the fiat leg and receipt and sets status PENDING, keeping the onchain leg", async () => {
    const out = await resetSamplePayment(tenantId, paymentId);
    expect(out.status).toBe("PENDING");

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { legs: true, receipt: true },
    });
    expect(payment.status).toBe("PENDING");
    expect(payment.receipt).toBeNull();
    expect(payment.legs.some((l) => l.legType === "FIAT")).toBe(false);
    expect(payment.legs.some((l) => l.legType === "ONCHAIN")).toBe(true);
  });

  it("is idempotent: running twice yields the same PENDING state", async () => {
    await resetSamplePayment(tenantId, paymentId);
    const out = await resetSamplePayment(tenantId, paymentId);
    expect(out.status).toBe("PENDING");
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId }, include: { legs: true, receipt: true },
    });
    expect(payment.legs.filter((l) => l.legType === "FIAT")).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { prisma } from "../../lib/db";
import { storeViewKey } from "../../lib/crypto/viewkey";
import { randomUUID } from "node:crypto";

describe("view key is never serialized (AGENT §8)", () => {
  it("the Payment serialization path never includes viewKey/encryptedKey material", async () => {
    const tenant = await prisma.tenant.create({ data: { name: `t-${randomUUID()}` } });
    // A real ViewKey exists for the tenant (encrypted at rest)...
    await storeViewKey(tenant.id, Buffer.from("super-secret-view-key-material"));

    // ...but the Payment GET serialization path (Phase 3) never selects view-key fields.
    const payment = await prisma.payment.create({
      data: {
        tenantId: tenant.id, intentId: `i-${randomUUID()}`, status: "PENDING",
        sourceAsset: "USDC", sourceAmount: "2500.00000000", targetCurrency: "PHP",
        corridorFrom: "USD", corridorTo: "PHP", recipientRef: "c1",
      },
      include: { legs: true, receipt: true },
    });

    const serialized = JSON.stringify(payment);
    expect(serialized.toLowerCase()).not.toContain("viewkey");
    expect(serialized).not.toContain("encryptedKey");

    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.viewKey.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });
});

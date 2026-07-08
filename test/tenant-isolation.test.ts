import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, forTenant } from "@/lib/db";

const TENANT_A = "test_tenant_a_isolation";
const TENANT_B = "test_tenant_b_isolation";
const INTENT_A = "intent_test_iso_a";
const INTENT_B = "intent_test_iso_b";

async function seedTenant(id: string, intentId: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id },
  });
  await prisma.user.upsert({
    where: { id: "user_" + id },
    update: {},
    create: { id: "user_" + id, tenantId: id, username: "user_" + id, passwordHash: "x" },
  });
  await prisma.payment.upsert({
    where: { intentId },
    update: {},
    create: {
      tenantId: id,
      intentId,
      sourceAsset: "USDC",
      sourceAmount: "100.00000000",
      targetCurrency: "PHP",
      corridorFrom: "USD",
      corridorTo: "PHP",
      recipientRef: "rcpt_" + id,
    },
  });
}

beforeAll(async () => {
  await seedTenant(TENANT_A, INTENT_A);
  await seedTenant(TENANT_B, INTENT_B);
});

afterAll(async () => {
  await prisma.paymentBatch.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
  await prisma.payment.deleteMany({ where: { intentId: { in: [INTENT_A, INTENT_B] } } });
  await prisma.user.deleteMany({ where: { id: { in: ["user_" + TENANT_A, "user_" + TENANT_B] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
  await prisma.$disconnect();
});

describe("forTenant tenant isolation", () => {
  it("findMany only returns the scoped tenant's payments", async () => {
    const aRows = await forTenant(TENANT_A).payment.findMany();
    expect(aRows.length).toBeGreaterThan(0);
    expect(aRows.every((p) => p.tenantId === TENANT_A)).toBe(true);
    expect(aRows.some((p) => p.intentId === INTENT_B)).toBe(false);
  });

  it("findUnique cannot read another tenant's payment by id", async () => {
    const bPayment = await prisma.payment.findUniqueOrThrow({ where: { intentId: INTENT_B } });
    const leaked = await forTenant(TENANT_A).payment.findUnique({ where: { id: bPayment.id } });
    expect(leaked).toBeNull();
  });

  it("create forces the scoped tenantId", async () => {
    const created = await forTenant(TENANT_A).payment.create({
      data: {
        // Attempt to smuggle TENANT_B — the extension must override it.
        tenantId: TENANT_B,
        intentId: "intent_test_iso_a_create",
        sourceAsset: "USDC",
        sourceAmount: "1.00000000",
        targetCurrency: "PHP",
        corridorFrom: "USD",
        corridorTo: "PHP",
        recipientRef: "rcpt_create",
      } as never,
    });
    expect(created.tenantId).toBe(TENANT_A);
    await prisma.payment.delete({ where: { id: created.id } });
  });

  it("PaymentBatch is tenant-scoped: create forces tenantId and reads isolate", async () => {
    const created = await forTenant(TENANT_A).paymentBatch.create({
      data: {
        // Smuggled TENANT_B must be overridden to TENANT_A.
        tenantId: TENANT_B,
        createdByUserId: "user_" + TENANT_A,
        count: 1,
        totalSourceAmount: "1.00000000",
      } as never,
    });
    expect(created.tenantId).toBe(TENANT_A);

    // Tenant B cannot see tenant A's batch.
    const leaked = await forTenant(TENANT_B).paymentBatch.findUnique({ where: { id: created.id } });
    expect(leaked).toBeNull();

    // Tenant A sees only its own batches.
    const aRows = await forTenant(TENANT_A).paymentBatch.findMany();
    expect(aRows.every((b) => b.tenantId === TENANT_A)).toBe(true);
  });
});

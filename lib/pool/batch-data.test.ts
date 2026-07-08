import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { listPoolBatches, getPoolBatchDetail } from "@/lib/pool/batch-data";

const TENANT = "test_tenant_batchdata_p6";
const OTHER = "test_tenant_batchdata_p6_other";
const USER = "test_user_batchdata_p6";
let batchId: string;

async function child(tenantId: string, batchId: string, intent: string, status: string, method = "POOL_WALLET") {
  await prisma.payment.create({
    data: {
      tenantId,
      batchId,
      intentId: intent,
      status: status as never,
      payoutMethod: method as never,
      sourceAsset: "XLM",
      sourceAmount: "5",
      targetCurrency: "XLM",
      corridorFrom: "XLM",
      corridorTo: "XLM",
      recipientRef: `rcpt_${intent}`,
    } as never,
  });
}

beforeAll(async () => {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: "Batch HQ" } });
  await prisma.tenant.upsert({ where: { id: OTHER }, update: {}, create: { id: OTHER, name: "Other" } });
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: USER, passwordHash: "x" },
  });
  const batch = await prisma.paymentBatch.create({
    data: { tenantId: TENANT, createdByUserId: USER, count: 3, totalSourceAmount: "15" },
  });
  batchId = batch.id;
  await child(TENANT, batchId, "bd_p6_1", "SETTLED");
  await child(TENANT, batchId, "bd_p6_2", "SETTLED", "POOL_BANK");
  await child(TENANT, batchId, "bd_p6_3", "PENDING");
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.paymentBatch.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("batch-data read model (P6)", () => {
  it("lists batches with a per-status roll-up", async () => {
    const batches = await listPoolBatches(TENANT);
    const b = batches.find((x) => x.id === batchId)!;
    expect(b.count).toBe(3);
    expect(b.totalSourceAmount).toBe("15");
    expect(b.createdByUsername).toBe(USER);
    expect(b.rollup.SETTLED).toBe(2);
    expect(b.rollup.PENDING).toBe(1);
    expect(b.rollup.FAILED).toBe(0);
  });

  it("returns batch detail with children ordered + roll-up", async () => {
    const detail = await getPoolBatchDetail(TENANT, batchId);
    expect(detail).not.toBeNull();
    expect(detail!.children).toHaveLength(3);
    expect(detail!.rollup.SETTLED).toBe(2);
    expect(detail!.children.some((c) => c.payoutMethod === "POOL_BANK")).toBe(true);
  });

  it("does not leak a batch to another tenant", async () => {
    expect(await getPoolBatchDetail(OTHER, batchId)).toBeNull();
    expect(await listPoolBatches(OTHER)).toHaveLength(0);
  });
});

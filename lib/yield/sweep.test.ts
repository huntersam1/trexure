import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Toggle ENABLE_YIELD at runtime while preserving every real env field (db.ts /
// log.ts read env, so a bare mock would break them).
const { flag } = vi.hoisted(() => ({ flag: { enabled: false } }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const env = { ...actual.env };
  Object.defineProperty(env, "ENABLE_YIELD", { get: () => flag.enabled, enumerable: true });
  return { ...actual, env };
});

import { prisma } from "@/lib/db";
import { saveYieldConfig } from "./config";
import { sweepIn } from "./sweep";

const TENANT = "test_tenant_yield_sweep_163";
let seq = 0;

async function pendingPayment(amount: string): Promise<string> {
  seq += 1;
  const p = await prisma.payment.create({
    data: {
      tenantId: TENANT,
      intentId: `intent_yield_sweep_${seq}`,
      status: "PENDING",
      sourceAsset: "USDC",
      sourceAmount: amount,
      targetCurrency: "PHP",
      corridorFrom: "USD",
      corridorTo: "PHP",
      recipientRef: "rcpt_sweep",
    } as never,
  });
  return p.id;
}

beforeAll(async () => {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: TENANT } });
});

beforeEach(async () => {
  flag.enabled = false;
  await prisma.yieldPosition.deleteMany({ where: { tenantId: TENANT } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.yieldConfig.deleteMany({ where: { tenantId: TENANT } });
});

afterAll(async () => {
  await prisma.yieldPosition.deleteMany({ where: { tenantId: TENANT } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.yieldConfig.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

describe("sweepIn", () => {
  it("is a pure no-op when the feature flag is off", async () => {
    flag.enabled = false;
    await saveYieldConfig(TENANT, { enabled: true }); // even with tenant config on...
    const id = await pendingPayment("1000");

    const res = await sweepIn(TENANT, id);
    expect(res).toEqual({ swept: false, reason: "feature-disabled" });

    const pos = await prisma.yieldPosition.findUnique({ where: { paymentId: id } });
    expect(pos).toBeNull();
    const pay = await prisma.payment.findUnique({ where: { id } });
    expect(pay!.status).toBe("PENDING");
  });

  it("no-ops when the tenant has not enabled yield (flag on)", async () => {
    flag.enabled = true;
    const id = await pendingPayment("1000");
    const res = await sweepIn(TENANT, id);
    expect(res).toEqual({ swept: false, reason: "disabled" });
    expect(await prisma.yieldPosition.findUnique({ where: { paymentId: id } })).toBeNull();
  });

  it("sweeps the eligible balance and transitions the payment to SWEPT_IN", async () => {
    flag.enabled = true;
    await saveYieldConfig(TENANT, { enabled: true, minIdleBuffer: "200", feeBps: "25" });
    const id = await pendingPayment("1000");

    const res = await sweepIn(TENANT, id);
    expect(res.swept).toBe(true);
    if (!res.swept) throw new Error("unreachable");
    expect(res.principal).toBe("800"); // 1000 - 200 buffer
    expect(res.sweptInAmount).toBe("799.60000000"); // 800 - 5bps slippage

    const pos = await prisma.yieldPosition.findUniqueOrThrow({ where: { paymentId: id } });
    expect(pos.status).toBe("SWEPT_IN");
    expect(pos.principal.toString()).toBe("800");
    expect(pos.sweptInAmount!.toString()).toBe("799.6");
    expect(pos.feeBps.toString()).toBe("25"); // snapshotted from config
    expect(pos.sweepInTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pos.sweepInLedger).toBeGreaterThan(0);

    const pay = await prisma.payment.findUniqueOrThrow({ where: { id } });
    expect(pay.status).toBe("SWEPT_IN");
  });

  it("does not sweep when the eligible amount is below the threshold", async () => {
    flag.enabled = true;
    await saveYieldConfig(TENANT, { enabled: true, minIdleBuffer: "800", sweepThreshold: "500" });
    const id = await pendingPayment("1000"); // eligible 200 < 500 threshold

    const res = await sweepIn(TENANT, id);
    expect(res).toEqual({ swept: false, reason: "below-threshold" });
    expect(await prisma.yieldPosition.findUnique({ where: { paymentId: id } })).toBeNull();
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id } });
    expect(pay.status).toBe("PENDING");
  });

  it("is idempotent: a second sweep is a no-op with a single position", async () => {
    flag.enabled = true;
    await saveYieldConfig(TENANT, { enabled: true });
    const id = await pendingPayment("1000");

    const first = await sweepIn(TENANT, id);
    const second = await sweepIn(TENANT, id);
    expect(first.swept).toBe(true);
    expect(second.swept).toBe(true);
    if (!second.swept) throw new Error("unreachable");
    expect(second.alreadyDone).toBe(true);

    const positions = await prisma.yieldPosition.findMany({ where: { paymentId: id } });
    expect(positions).toHaveLength(1);
  });
});

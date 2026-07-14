import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { saveYieldConfig } from "./config";
import { loadYieldDashboard } from "./dashboard";

const TENANT = "test_tenant_yield_dash_166";

async function position(paymentIntent: string, status: string, principal: string, accrued = "0") {
  const p = await prisma.payment.create({
    data: {
      tenantId: TENANT, intentId: paymentIntent, status: "PENDING",
      sourceAsset: "USDC", sourceAmount: principal, targetCurrency: "PHP",
      corridorFrom: "USD", corridorTo: "PHP", recipientRef: "r",
    } as never,
  });
  await prisma.yieldPosition.create({
    data: { tenantId: TENANT, paymentId: p.id, status: status as never, principal, accruedYield: accrued } as never,
  });
}

beforeAll(async () => {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: TENANT } });
  await saveYieldConfig(TENANT, { enabled: true, minIdleBuffer: "10", feeBps: "25" });
  await position("dash_in_1", "SWEPT_IN", "800");
  await position("dash_in_2", "SWEPT_IN", "200");
  await position("dash_out_1", "SWEPT_OUT", "500", "50");
  await position("dash_failed_1", "FAILED", "300");
});

afterAll(async () => {
  await prisma.yieldPosition.deleteMany({ where: { tenantId: TENANT } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.yieldConfig.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

describe("loadYieldDashboard", () => {
  it("aggregates in-yield balance, accrued, counts, fee and APY", async () => {
    const d = await loadYieldDashboard(TENANT);

    expect(d.config.enabled).toBe(true);
    expect(d.asset).toBe("YLDS");
    // Sum of SWEPT_IN principals (800 + 200); SWEPT_OUT/FAILED excluded.
    expect(d.inYieldBalance).toBe("1000.00");
    expect(d.activePositions).toBe(2);
    expect(d.unwoundCount).toBe(1);
    expect(d.failedCount).toBe(1);
    // Realized accrued (only the SWEPT_OUT position earned).
    expect(d.accruedTotal).toBe("50.00000000");
    // 25 bps of 50 = 0.125; net = 49.875.
    expect(d.platformFeeTotal).toBe("0.12500000");
    expect(d.netYieldTotal).toBe("49.87500000");
    expect(d.apy).toBe("5.00");
  });
});

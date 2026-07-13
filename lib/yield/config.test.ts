import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import { loadYieldConfig, saveYieldConfig } from "./config";

const TENANT = "test_tenant_yield_161";
const OTHER = "test_tenant_yield_161_other";

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id } });
  }
});

afterAll(async () => {
  await prisma.yieldConfig.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("loadYieldConfig", () => {
  it("returns safe disabled defaults when no row exists", async () => {
    const cfg = await loadYieldConfig(OTHER);
    expect(cfg).toEqual({
      enabled: false,
      yieldAsset: "YLDS",
      minIdleBuffer: "0",
      sweepThreshold: "0",
      feeBps: "0",
    });
  });
});

describe("saveYieldConfig", () => {
  it("creates then round-trips a full config", async () => {
    const saved = await saveYieldConfig(TENANT, {
      enabled: true,
      yieldAsset: "YLDS",
      minIdleBuffer: "1000.5",
      sweepThreshold: "250",
      feeBps: "25",
    });
    expect(saved.enabled).toBe(true);
    expect(saved.minIdleBuffer).toBe("1000.5");
    expect(saved.sweepThreshold).toBe("250");
    expect(saved.feeBps).toBe("25");

    const loaded = await loadYieldConfig(TENANT);
    expect(loaded).toEqual(saved);
  });

  it("merges a partial patch over existing values (upsert, single row per tenant)", async () => {
    await saveYieldConfig(TENANT, { minIdleBuffer: "2000" });
    const cfg = await loadYieldConfig(TENANT);
    // Untouched fields survive; only the buffer changed.
    expect(cfg.minIdleBuffer).toBe("2000");
    expect(cfg.enabled).toBe(true);
    expect(cfg.feeBps).toBe("25");

    const rows = await prisma.yieldConfig.findMany({ where: { tenantId: TENANT } });
    expect(rows.length).toBe(1);
  });

  it("persists a fee ≥ 1000 bps without overflowing the column (regression, PR #168 review)", async () => {
    // Decimal(5,2) capped at 999.99; a 25% (2500 bps) fee must round-trip, not 500.
    const saved = await saveYieldConfig(TENANT, { feeBps: "2500" });
    expect(saved.feeBps).toBe("2500");
    const loaded = await loadYieldConfig(TENANT);
    expect(loaded.feeBps).toBe("2500");
  });

  it("accepts the max 10000 bps (100%) boundary", async () => {
    const saved = await saveYieldConfig(TENANT, { feeBps: "10000" });
    expect(saved.feeBps).toBe("10000");
  });

  it("rejects a negative buffer with 422", async () => {
    await expect(saveYieldConfig(TENANT, { minIdleBuffer: "-1" })).rejects.toMatchObject({
      status: 422,
    } as Partial<AppError>);
  });

  it("rejects feeBps above 10000 with 422", async () => {
    await expect(saveYieldConfig(TENANT, { feeBps: "10001" })).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a non-numeric amount with 422", async () => {
    await expect(saveYieldConfig(TENANT, { sweepThreshold: "abc" })).rejects.toMatchObject({
      status: 422,
    } as Partial<AppError>);
  });
});

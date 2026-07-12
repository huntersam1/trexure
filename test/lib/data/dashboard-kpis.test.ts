import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

const { requireSession, agg, count, findMany } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  agg: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession }));
vi.mock("@/lib/db", () => ({ forTenant: () => ({ payment: { aggregate: agg, count, findMany } }) }));

import { getDashboardKpis } from "@/lib/data/payments";

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ tenantId: "t1" });
  agg.mockResolvedValue({ _sum: { sourceAmount: new Prisma.Decimal("30.75") } });
  count.mockResolvedValue(3);
  const now = Date.now();
  // Promise.all order: aggregate, count, findMany(recent take:8), findMany(window take:200).
  findMany.mockReset();
  findMany
    .mockResolvedValueOnce([]) // recent list
    .mockResolvedValueOnce([
      { createdAt: new Date(now - 5 * 60000), updatedAt: new Date(now) }, // 5 min
      { createdAt: new Date(now - 15 * 60000), updatedAt: new Date(now) }, // 15 min
    ]);
});

describe("getDashboardKpis (#143 H4 — bounded/aggregated reads)", () => {
  it("sums settled volume in the DB and bounds the settlement-time sample", async () => {
    const kpis = await getDashboardKpis();
    // Volume is a DB aggregate, not an unbounded findMany reduced in JS.
    expect(agg).toHaveBeenCalledWith({ where: { status: "SETTLED" }, _sum: { sourceAmount: true } });
    // The settlement-time average samples a bounded window (take: 200).
    const windowCall = findMany.mock.calls.find((c) => c[0]?.take === 200);
    expect(windowCall?.[0]).toMatchObject({
      where: { status: "SETTLED" },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    expect(kpis.volumeSettled).toBe("30.75");
    expect(kpis.pendingCount).toBe(3);
    expect(kpis.avgSettlementMins).toBe("10.0"); // (5 + 15) / 2
  });

  it("reports 0 volume / 0 avg when nothing has settled", async () => {
    agg.mockResolvedValue({ _sum: { sourceAmount: null } });
    findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const kpis = await getDashboardKpis();
    expect(kpis.volumeSettled).toBe("0.00");
    expect(kpis.avgSettlementMins).toBe("0.0");
  });
});

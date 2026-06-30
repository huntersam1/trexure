import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// requireSession resolves to a Tenant-A admin without touching cookies/DB sessions.
const SESSION_USER = { id: "iso-user-a", username: "iso-a", role: "ADMIN", tenantId: "" } as {
  id: string; username: string; role: "ADMIN" | "MEMBER"; tenantId: string;
};
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => SESSION_USER,
}));

import { prisma, forTenant } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";

let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  const a = await prisma.tenant.create({ data: { name: `iso-A-${Date.now()}` } });
  const b = await prisma.tenant.create({ data: { name: `iso-B-${Date.now()}` } });
  tenantA = a.id;
  tenantB = b.id;
  SESSION_USER.tenantId = tenantA;

  // One payment per tenant (base client sets tenantId explicitly).
  await prisma.payment.create({
    data: {
      tenantId: tenantA, intentId: `intent-A-${Date.now()}`, sourceAsset: "USDC",
      sourceAmount: "100.00", targetCurrency: "PHP", corridorFrom: "USD", corridorTo: "PHP",
      recipientRef: "ref-a",
    },
  });
  await prisma.payment.create({
    data: {
      tenantId: tenantB, intentId: `intent-B-${Date.now()}`, sourceAsset: "USDC",
      sourceAmount: "200.00", targetCurrency: "PHP", corridorFrom: "USD", corridorTo: "PHP",
      recipientRef: "ref-b",
    },
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.$disconnect();
});

describe("tenant isolation under a session context", () => {
  it("a Tenant-A session can only read Tenant-A payments via forTenant", async () => {
    const user = await requireSession();
    const db = forTenant(user.tenantId);
    const rows = await db.payment.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.tenantId === tenantA)).toBe(true);
    expect(rows.some((p) => p.tenantId === tenantB)).toBe(false);
  });

  it("a Tenant-A session cannot fetch a Tenant-B payment by id", async () => {
    const user = await requireSession();
    const db = forTenant(user.tenantId);
    const bPayment = await prisma.payment.findFirst({ where: { tenantId: tenantB } });
    const leaked = await db.payment.findFirst({ where: { id: bPayment!.id } });
    expect(leaked).toBeNull();
  });
});

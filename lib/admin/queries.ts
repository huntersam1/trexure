import "server-only";
import { prisma } from "../db";

export async function listTenantsWithCounts(): Promise<
  Array<{ id: string; name: string; userCount: number; createdAt: Date }>
> {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, _count: { select: { users: true } } },
  });
  return tenants.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, userCount: t._count.users }));
}

export async function listWebhookEvents(limit = 100): Promise<
  Array<{ id: string; provider: string; externalId: string; verified: boolean; processedAt: Date | null; createdAt: Date }>
> {
  return prisma.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, provider: true, externalId: true, verified: true, processedAt: true, createdAt: true },
  });
}

export async function recentAuditLogs(limit = 25): Promise<
  Array<{ id: string; action: string; tenantId: string | null; userId: string | null; target: string | null; createdAt: Date }>
> {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, tenantId: true, userId: true, target: true, createdAt: true },
  });
}

import "server-only";
import { prisma } from "../db";
import { logger } from "../log";

export interface AuditEntry {
  action: string;
  tenantId?: string | null;
  userId?: string | null;
  target?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Best-effort audit write. Uses base `prisma` (not forTenant) so platform-level
 * ADMIN actions with a null tenant are allowed. Must never throw into a request path.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        tenantId: entry.tenantId ?? null,
        userId: entry.userId ?? null,
        target: entry.target,
        metadata: entry.metadata as never,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "audit write failed");
  }
}

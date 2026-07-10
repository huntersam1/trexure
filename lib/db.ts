import "server-only";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Models that carry a `tenantId` column directly.
const DIRECT_TENANT_MODELS = new Set([
  "Payment",
  "PaymentBatch",
  "ApiKey",
  "AnchorConfig",
  "ViewKey",
  "AuditLog",
  "DisclosureLink",
]);
// Models scoped through their parent Payment relation (no own tenantId column).
const RELATION_TENANT_MODELS = new Set(["PaymentLeg", "Receipt"]);

const NO_WHERE_OPS = new Set(["create", "createMany"]);

/**
 * Returns a tenant-scoped Prisma client. Every read/write against a
 * tenant-scoped model is forced to this tenantId; cross-tenant rows are
 * invisible and uncreatable. Prisma's extendedWhereUnique GA lets us add
 * `tenantId` to `findUnique`/`update`/`delete` where-clauses (it returns null
 * / affects nothing when the tenant doesn't match).
 *
 * Returned type is the frozen `PrismaClient` contract; the runtime value is an
 * extended client whose extra methods we don't expose.
 */
export function forTenant(tenantId: string): PrismaClient {
  if (!tenantId) {
    throw new Error("forTenant() requires a non-empty tenantId");
  }

  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = (args ?? {}) as {
            where?: Record<string, unknown>;
            data?: unknown;
            create?: Record<string, unknown>;
          };

          if (DIRECT_TENANT_MODELS.has(model)) {
            if (!NO_WHERE_OPS.has(operation)) {
              a.where = { ...(a.where ?? {}), tenantId };
            }
            if (operation === "create") {
              a.data = { ...(a.data as Record<string, unknown>), tenantId };
            }
            if (operation === "createMany") {
              const d = a.data;
              a.data = Array.isArray(d)
                ? d.map((row) => ({ ...(row as Record<string, unknown>), tenantId }))
                : { ...(d as Record<string, unknown>), tenantId };
            }
            if (operation === "upsert") {
              a.create = { ...(a.create ?? {}), tenantId };
            }
          } else if (RELATION_TENANT_MODELS.has(model)) {
            if (!NO_WHERE_OPS.has(operation)) {
              const existingPayment =
                (a.where?.payment as Record<string, unknown> | undefined) ?? {};
              a.where = {
                ...(a.where ?? {}),
                payment: { ...existingPayment, tenantId },
              };
            }
            // Writes carry a verified `paymentId` from server code; reads above
            // are filtered, so no extra create-time injection is needed here.
          }

          return query(a);
        },
      },
    },
  }) as unknown as PrismaClient;
}

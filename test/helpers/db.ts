import { PrismaClient } from "../../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prismaForTest = new PrismaClient({ adapter });

export async function resetDb(): Promise<void> {
  // Delete in FK-safe order: every tenant/user/payment-referencing row before
  // the tenants themselves (ViewKey/AnchorConfig/ApiKey/Session all FK a tenant
  // or user — e.g. the Phase 0 seed's ViewKey would otherwise block the wipe).
  await prismaForTest.paymentLeg.deleteMany();
  await prismaForTest.receipt.deleteMany();
  await prismaForTest.payment.deleteMany();
  await prismaForTest.paymentBatch.deleteMany();
  await prismaForTest.apiKey.deleteMany();
  await prismaForTest.anchorConfig.deleteMany();
  await prismaForTest.viewKey.deleteMany();
  await prismaForTest.session.deleteMany();
  await prismaForTest.user.deleteMany();
  await prismaForTest.tenant.deleteMany();
}

export async function seedTenant(name: string): Promise<{ tenantId: string }> {
  const t = await prismaForTest.tenant.create({ data: { name } });
  return { tenantId: t.id };
}

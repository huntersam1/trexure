import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma, forTenant } from "@/lib/db";
import { provisionTenant } from "@/lib/auth/signup";
import { verifyPassword } from "@/lib/auth/password";
import { loadViewKey } from "@/lib/crypto/viewkey";
import { deriveCommitment, hexCommitment } from "@/lib/zk/commit";
import { AppError } from "@/lib/http/problem";

// Unique per run so this suite can share the dev DB with other suites.
const RUN = randomBytes(4).toString("hex");
const createdTenantIds: string[] = [];

async function signup(overrides: Partial<Parameters<typeof provisionTenant>[0]> = {}) {
  const out = await provisionTenant({
    tenantName: `Signup Test ${RUN}`,
    username: `signup_user_${RUN}${overrides.username ?? ""}`,
    password: "correct-horse-battery-staple",
    ...overrides,
  });
  createdTenantIds.push(out.tenantId);
  return out;
}

afterAll(async () => {
  await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: { in: createdTenantIds } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await prisma.anchorConfig.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await prisma.viewKey.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await prisma.session.deleteMany({ where: { user: { tenantId: { in: createdTenantIds } } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prisma.$disconnect();
});

describe("provisionTenant (#33)", () => {
  it("provisions tenant + ADMIN user + view key + anchor config + demo-ready sample payment", async () => {
    const out = await signup();

    const user = await prisma.user.findFirst({ where: { tenantId: out.tenantId } });
    expect(user?.role).toBe("ADMIN");
    // argon2id hash, never the plaintext.
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user!.passwordHash, "correct-horse-battery-staple")).toBe(true);

    // View key decrypts and reproduces the sample payment's REAL ZK commitment.
    const viewKey = await loadViewKey(out.tenantId);
    const payment = await prisma.payment.findUnique({
      where: { id: out.samplePaymentId },
      include: { legs: true },
    });
    expect(payment?.shielded).toBe(true);
    expect(payment?.status).toBe("PENDING");
    expect(payment?.proofHash).toBe(
      hexCommitment(deriveCommitment(viewKey, payment!.intentId).commitment),
    );
    // On-chain leg CONFIRMED, no fiat leg — Demo Replay beats 1-2 ready.
    expect(payment?.legs).toHaveLength(1);
    expect(payment?.legs[0]).toMatchObject({ legType: "ONCHAIN", status: "CONFIRMED" });

    const anchor = await prisma.anchorConfig.findFirst({ where: { tenantId: out.tenantId } });
    expect(anchor?.provider).toBe("mock-anchor");
  });

  it("rejects a duplicate username with 409 and leaves no partial tenant behind", async () => {
    const first = await signup({ username: `signup_dup_${RUN}` });
    const before = await prisma.tenant.count();
    await expect(signup({ username: `signup_dup_${RUN}` })).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<AppError>);
    // The transaction rolled back — no orphaned tenant.
    expect(await prisma.tenant.count()).toBe(before);
    expect(first.tenantId).toBeTruthy();
  });

  it("isolates the new tenant's data behind forTenant()", async () => {
    const a = await signup({ username: `signup_iso_a_${RUN}` });
    const b = await signup({ username: `signup_iso_b_${RUN}` });

    const dbB = forTenant(b.tenantId);
    // Tenant B cannot see tenant A's sample payment.
    expect(await dbB.payment.findFirst({ where: { id: a.samplePaymentId } })).toBeNull();
    // But sees its own.
    expect(await dbB.payment.findFirst({ where: { id: b.samplePaymentId } })).not.toBeNull();
  });
});

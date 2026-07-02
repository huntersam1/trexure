import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { aesEncrypt } from "@/lib/crypto/aes";
import { deriveCommitment, hexCommitment } from "@/lib/zk/commit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";
import { Prisma } from "@/lib/generated/prisma/client";
import type { SignupInput } from "@/lib/validation/auth";

// Prisma 7's `Bytes` input type is `Uint8Array<ArrayBuffer>`; Node `Buffer`s
// aren't assignable under strict TS even though a Buffer IS a Uint8Array at
// runtime. Assert at the persistence boundary (same convention as viewkey.ts).
const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => b as unknown as Uint8Array<ArrayBuffer>;

/**
 * Per-IP signup throttle policy. Provisioning is expensive, so it's throttled
 * harder than login and per-IP only (per-username would leak which usernames
 * exist before the create runs). Shared by both signup entry points so the
 * key and policy can't drift — they write the same Redis key.
 */
export const SIGNUP_RATE_LIMIT = { limit: 5, windowSec: 3600 } as const;
export const signupRateLimitKey = (ip: string): string => `signup:ip:${ip}`;

export type ProvisionedTenant = {
  tenantId: string;
  userId: string;
  samplePaymentId: string;
};

/**
 * Self-serve signup (#33): provision a complete, demo-ready tenant in one
 * transaction — Tenant, ADMIN user (argon2id), view key (AES-encrypted at
 * rest), default mock-anchor AnchorConfig, and a seeded sample shielded
 * payment (on-chain leg CONFIRMED, no fiat leg) so the new tenant's
 * dashboard demos instantly, mirroring prisma/seed.ts.
 *
 * All rows are tenant-scoped; the runtime read path goes through forTenant()
 * so the new tenant's data is isolated by construction.
 */
export async function provisionTenant(input: SignupInput): Promise<ProvisionedTenant> {
  const passwordHash = await hashPassword(input.password);

  // Tenant view key: random 32-byte secret, encrypted under the master key at
  // rest (mirrors prisma/seed.ts and lib/crypto/viewkey.ts).
  const viewKeyMaterial = randomBytes(32);
  const encViewKey = aesEncrypt(viewKeyMaterial);

  // Default mock-anchor config (webhook secret encrypted at rest, like seed).
  const anchorSecret = aesEncrypt(Buffer.from(env.ANCHOR_CALLBACK_TOKEN, "utf8"));

  // Sample shielded payment: payload encrypted under the VIEW key so
  // /decrypt round-trips; proofHash is the REAL ZK commitment for this
  // intentId so /verify-proof can regenerate + verify the proof on-chain.
  const intentId = `intent_seed_demo_${randomBytes(12).toString("hex")}`;
  const shieldedBlob = aesEncrypt(
    Buffer.from(
      JSON.stringify({
        sender: input.tenantName,
        recipient: "Contractor (Manila)",
        asset: "USDC",
        amount: "2500.00",
      }),
      "utf8",
    ),
    viewKeyMaterial, // wrap under the VIEW key so /decrypt (loadViewKey) round-trips
  );
  const proofHash = hexCommitment(deriveCommitment(viewKeyMaterial, intentId).commitment);

  try {
    return await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.tenantName } });
      const user = await tx.user.create({
        data: { username: input.username, role: "ADMIN", tenantId: tenant.id, passwordHash },
      });
      await tx.viewKey.create({
        data: {
          tenantId: tenant.id,
          encryptedKey: asBytes(encViewKey.ciphertext),
          nonce: asBytes(encViewKey.nonce),
        },
      });
      await tx.anchorConfig.create({
        data: {
          tenantId: tenant.id,
          provider: "mock-anchor",
          webhookSecret: asBytes(anchorSecret.ciphertext),
          config: { currency: "PHP", nonce: anchorSecret.nonce.toString("base64") },
        },
      });
      const payment = await tx.payment.create({
        data: {
          tenantId: tenant.id,
          intentId,
          status: "PENDING",
          sourceAsset: "USDC",
          sourceAmount: "2500.00000000",
          targetCurrency: "PHP",
          targetAmount: null,
          corridorFrom: "USD",
          corridorTo: "PHP",
          recipientRef: "rcpt_demo_contractor_ph",
          shielded: true,
          encryptedPayload: asBytes(shieldedBlob.ciphertext),
          payloadNonce: asBytes(shieldedBlob.nonce),
          proofHash,
          legs: {
            create: {
              legType: "ONCHAIN",
              status: "CONFIRMED",
              txHash: `demo_tx_${tenant.id.slice(0, 8)}`,
              ledger: 1234567,
              contractId: env.ZK_CONTRACT_ID,
            },
          },
        },
      });
      return { tenantId: tenant.id, userId: user.id, samplePaymentId: payment.id };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "Username unavailable", "That username is already taken.");
    }
    throw err;
  }
}

/**
 * The shared post-validation, post-rate-limit signup sequence: provision the
 * tenant, open a session, and write the audit log. Both entry points (the
 * server action and POST /api/auth/signup) call this so the provisioning +
 * session + audit-action-name policy lives in exactly one place and can't drift.
 * Callers own their own validation, rate-limit response shape, and error mapping.
 */
export async function completeSignup(
  input: SignupInput,
  ip: string,
  userAgent?: string,
): Promise<ProvisionedTenant> {
  const provisioned = await provisionTenant(input);
  // Session creation and the audit write are independent — run them together.
  await Promise.all([
    createSession(provisioned.userId, ip, userAgent),
    prisma.auditLog.create({
      data: { tenantId: provisioned.tenantId, userId: provisioned.userId, action: "auth.signup", ip },
    }),
  ]);
  logger.info({ tenantId: provisioned.tenantId, ip }, "auth.signup.success");
  return provisioned;
}

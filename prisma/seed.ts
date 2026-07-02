import "dotenv/config";
import * as crypto from "node:crypto";
import argon2 from "argon2";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { deriveCommitment, hexCommitment } from "../lib/zk/commit";
import { quoteTargetAmount } from "../lib/fx";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Deterministic ids so re-running the seed (and Demo Replay resets) is safe.
const SEED_TENANT_ID = "seed_tenant_trexure_hq";
const SAMPLE_INTENT_ID = "intent_seed_demo_usd_php_0001";

/**
 * Inline AES-256-GCM (MASTER_ENCRYPTION_KEY). Mirrors lib/crypto/aes.ts (Phase 2).
 * Returns plain `Uint8Array`s (fresh ArrayBuffer-backed) so they satisfy Prisma's
 * `Bytes` field type under TS strict (Node `Buffer` is `Buffer<ArrayBufferLike>`).
 */
/** Copy any byte source into a fresh ArrayBuffer-backed `Uint8Array<ArrayBuffer>`. */
function toBytes(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(src.byteLength);
  out.set(src);
  return out;
}

function aesEncrypt(
  plaintext: Buffer,
  key: Buffer = Buffer.from(process.env.MASTER_ENCRYPTION_KEY ?? "", "base64"),
): {
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
} {
  if (key.length !== 32) {
    throw new Error("AES key must be 32 bytes (MASTER_ENCRYPTION_KEY base64 or a view key)");
  }
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: toBytes(Buffer.concat([enc, tag])),
    nonce: toBytes(nonce),
  };
}

function isWeakPassword(pw: string): boolean {
  return pw.trim().length < 12;
}

async function main() {
  const isProd = process.env.NODE_ENV === "production";
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  const tenantName = process.env.SEED_ADMIN_TENANT ?? "Trexure HQ";

  if (isProd && (password === "" || isWeakPassword(password))) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be set and >= 12 chars in production; refusing to seed.",
    );
  }
  if (password === "") {
    throw new Error("SEED_ADMIN_PASSWORD is required to seed an admin user.");
  }

  // 1) Tenant (upsert by deterministic id).
  const tenant = await prisma.tenant.upsert({
    where: { id: SEED_TENANT_ID },
    update: { name: tenantName },
    create: { id: SEED_TENANT_ID, name: tenantName },
  });

  // 2) Admin user (argon2id hash; upsert by unique username).
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { username },
    update: { role: "ADMIN", tenantId: tenant.id, passwordHash },
    create: { username, role: "ADMIN", tenantId: tenant.id, passwordHash },
  });

  // 3) Tenant ViewKey (encrypted at rest). The "view key" material is a random
  //    32-byte secret for the demo; encrypted with MASTER_ENCRYPTION_KEY.
  const viewKeyMaterial = crypto.randomBytes(32);
  const enc = aesEncrypt(viewKeyMaterial);
  await prisma.viewKey.upsert({
    where: { tenantId: tenant.id },
    update: { encryptedKey: enc.ciphertext, nonce: enc.nonce },
    create: { tenantId: tenant.id, encryptedKey: enc.ciphertext, nonce: enc.nonce },
  });

  // 4) Sample AnchorConfig (provider "mock-anchor"; webhook secret encrypted).
  const anchorSecret = aesEncrypt(
    Buffer.from(process.env.ANCHOR_CALLBACK_TOKEN ?? "seed-anchor-secret", "utf8"),
  );
  const existingAnchor = await prisma.anchorConfig.findFirst({
    where: { tenantId: tenant.id, provider: "mock-anchor" },
  });
  if (existingAnchor) {
    await prisma.anchorConfig.update({
      where: { id: existingAnchor.id },
      data: {
        webhookSecret: anchorSecret.ciphertext,
        config: { currency: "PHP", nonce: Buffer.from(anchorSecret.nonce).toString("base64") },
      },
    });
  } else {
    await prisma.anchorConfig.create({
      data: {
        tenantId: tenant.id,
        provider: "mock-anchor",
        webhookSecret: anchorSecret.ciphertext,
        config: { currency: "PHP", nonce: Buffer.from(anchorSecret.nonce).toString("base64") },
      },
    });
  }

  // 5) Sample shielded Payment (USD->PHP, $2,500). On-chain leg present, NO
  //    fiat leg yet, so Demo Replay beats 1-2 are ready on first boot and
  //    beats 3-4 trigger the Mock Anchor payout. Idempotent on intentId.
  // Shield the payload under the tenant's VIEW KEY (not the master key) so the
  // /decrypt endpoint — which unwraps with loadViewKey — round-trips. Encrypting
  // under the master key here caused a GCM auth-tag failure (500) on decrypt.
  const shieldedBlob = aesEncrypt(
    Buffer.from(
      JSON.stringify({
        sender: "Trexure HQ",
        recipient: "Contractor (Manila)",
        asset: "USDC",
        amount: "2500.00",
      }),
      "utf8",
    ),
    viewKeyMaterial,
  );
  // proofHash is the REAL ZK public commitment derived from the tenant view key
  // + intentId (commitment = secret^2 + blinding). The /verify-proof endpoint
  // regenerates the Groth16 proof for this commitment and verifies it on-chain.
  const proofHash = hexCommitment(deriveCommitment(viewKeyMaterial, SAMPLE_INTENT_ID).commitment);

  const payment = await prisma.payment.upsert({
    where: { intentId: SAMPLE_INTENT_ID },
    update: {
      status: "PENDING",
      shielded: true,
      encryptedPayload: shieldedBlob.ciphertext,
      payloadNonce: shieldedBlob.nonce,
      proofHash,
      targetAmount: quoteTargetAmount("2500.00", "USD", "PHP"),
    },
    create: {
      tenantId: tenant.id,
      intentId: SAMPLE_INTENT_ID,
      status: "PENDING",
      sourceAsset: "USDC",
      sourceAmount: "2500.00000000",
      targetCurrency: "PHP",
      targetAmount: quoteTargetAmount("2500.00", "USD", "PHP"),
      corridorFrom: "USD",
      corridorTo: "PHP",
      recipientRef: "rcpt_demo_contractor_ph",
      shielded: true,
      encryptedPayload: shieldedBlob.ciphertext,
      payloadNonce: shieldedBlob.nonce,
      proofHash,
    },
  });

  // On-chain leg (idempotent via @@unique([paymentId, legType])).
  await prisma.paymentLeg.upsert({
    where: { paymentId_legType: { paymentId: payment.id, legType: "ONCHAIN" } },
    update: {
      status: "CONFIRMED",
      txHash: "demo_tx_" + payment.id.slice(0, 8),
      ledger: 1234567,
      contractId: process.env.ZK_CONTRACT_ID ?? "CDEMO_CONTRACT",
    },
    create: {
      paymentId: payment.id,
      legType: "ONCHAIN",
      status: "CONFIRMED",
      txHash: "demo_tx_" + payment.id.slice(0, 8),
      ledger: 1234567,
      contractId: process.env.ZK_CONTRACT_ID ?? "CDEMO_CONTRACT",
    },
  });

  // Reset any prior fiat leg + receipt so Demo Replay can re-run from beat 3.
  await prisma.paymentLeg.deleteMany({
    where: { paymentId: payment.id, legType: "FIAT" },
  });
  await prisma.receipt.deleteMany({ where: { paymentId: payment.id } });

  console.log(`Seeded tenant=${tenant.id} admin=${username} payment=${payment.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  });

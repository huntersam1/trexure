import "dotenv/config";
import * as crypto from "node:crypto";
import argon2 from "argon2";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { deriveCommitment, hexCommitment } from "../lib/zk/commit";
import { quoteTargetAmount, quoteFxRate } from "../lib/fx";
import { buildSampleOnchainLeg } from "../lib/payments/sample-onchain-leg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Deterministic ids so re-running the seed (and Demo Replay resets) is safe.
const SEED_TENANT_ID = "seed_tenant_trexure_hq";
const SAMPLE_INTENT_ID = "intent_seed_demo_usd_php_0001";

// Rich demo dataset (#107). All demo rows use these markers so a re-run is
// idempotent (deleted then recreated) WITHOUT touching the Demo Replay sample
// (which uses the distinct `intent_seed_demo_` prefix).
const DEMO_INTENT_PREFIX = "intent_demo_";
const DEMO_BATCH_ID = "seed_demo_batch_0001";
const DEMO_AUDIT_IP = "seed-script"; // marks demo audit rows for idempotent cleanup

const MEMBER_USERNAME = process.env.SEED_MEMBER_USERNAME ?? "member";
const MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD ?? "demo-member-pass-2026";
const RECEIVERS = [
  { id: "seed_demo_receiver_maria", email: "maria@freelance.demo", password: "demo-maria-pass-2026", label: "Maria Santos" },
  { id: "seed_demo_receiver_jose", email: "jose@freelance.demo", password: "demo-jose-pass-2026", label: "Jose Cruz" },
  { id: "seed_demo_receiver_ana", email: "ana@freelance.demo", password: "demo-ana-pass-2026", label: "Ana Reyes" },
] as const;

// Fixed clock so runs are reproducible (never Date.now()). Override with
// SEED_BASE_DATE for a live demo anchored to today.
const BASE = new Date(process.env.SEED_BASE_DATE ?? "2026-07-08T12:00:00.000Z");

function daysBefore(n: number, hour = 9): Date {
  const d = new Date(BASE);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

/** Deterministic, plausible-looking testnet-style tx hash (64 hex chars). */
function demoTx(suffix: string): string {
  return crypto.createHash("sha256").update(`txdemo:${suffix}`).digest("hex");
}

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

  // 2) Admin user (argon2id hash; upsert by unique username). The seeded HQ
  //    admin is the platform operator (#143 C1) — the ONLY isPlatformAdmin, so
  //    the /admin console keeps working in demos while self-signup admins stay
  //    confined to their own tenant.
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: "ADMIN", tenantId: tenant.id, passwordHash, isPlatformAdmin: true },
    create: { username, role: "ADMIN", tenantId: tenant.id, passwordHash, isPlatformAdmin: true },
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

  // On-chain leg (idempotent via @@unique([paymentId, legType])). Real
  // shielded_transfer testnet tx when SEED_ONCHAIN=true + a funded key, else
  // an offline placeholder — shared with signup so the two can't drift (#45).
  const onchainLeg = await buildSampleOnchainLeg({
    intentId: SAMPLE_INTENT_ID,
    amount: "2500.00",
    sourceAsset: "USDC",
    proofHash,
    placeholderRef: payment.id,
  });
  await prisma.paymentLeg.upsert({
    where: { paymentId_legType: { paymentId: payment.id, legType: "ONCHAIN" } },
    update: {
      status: onchainLeg.status,
      txHash: onchainLeg.txHash,
      ledger: onchainLeg.ledger,
      contractId: onchainLeg.contractId,
    },
    create: {
      paymentId: payment.id,
      legType: "ONCHAIN",
      status: onchainLeg.status,
      txHash: onchainLeg.txHash,
      ledger: onchainLeg.ledger,
      contractId: onchainLeg.contractId,
    },
  });

  // Reset any prior fiat leg + receipt so Demo Replay can re-run from beat 3.
  await prisma.paymentLeg.deleteMany({
    where: { paymentId: payment.id, legType: "FIAT" },
  });
  await prisma.receipt.deleteMany({ where: { paymentId: payment.id } });

  // 6) Rich demo dataset (#107) — the full end-to-end story across both rails
  //    and every status, so every screen looks real in a demo.
  const demo = await seedRichDemo({ tenantId: tenant.id, adminUserId: admin.id, viewKeyMaterial });

  console.log(`Seeded tenant=${tenant.id} admin=${username} sample=${payment.id}`);
  console.log(
    `Demo dataset: ${demo.paymentCount} payments (${demo.settledCount} settled / ${demo.exceptionCount} exceptions), ` +
      `1 batch (${demo.batchClaimed} claimed / ${demo.batchUnclaimed} unclaimed), ${RECEIVERS.length} receivers, ${demo.auditCount} audit rows.`,
  );
  console.log("Demo logins (see docs/demo/demo-credentials.md):");
  console.log(`  ADMIN  ${username} / <SEED_ADMIN_PASSWORD>`);
  console.log(`  MEMBER ${MEMBER_USERNAME} / ${MEMBER_PASSWORD}`);
  for (const r of RECEIVERS) console.log(`  RECEIVER ${r.email} / ${r.password}`);
}

// ---------------------------------------------------------------------------
// Rich demo dataset
// ---------------------------------------------------------------------------

type LegStatus = "PENDING" | "RECEIVED" | "CONFIRMED" | "FAILED";
type PaymentStatus = "DRAFT" | "PENDING" | "ONCHAIN_CONFIRMED" | "RECONCILING" | "SETTLED" | "FAILED";

interface PaymentSpec {
  suffix: string;
  status: PaymentStatus;
  createdAt: Date;
  sourceAsset: string;
  sourceAmount: string;
  targetCurrency: string;
  targetAmount: string | null;
  corridorFrom: string;
  corridorTo: string;
  recipientRef: string;
  payoutMethod?: "POOL_WALLET" | "POOL_BANK";
  batchId?: string;
  receiverId?: string;
  poolCommitment?: string;
  shield?: { sender: string; recipient: string };
  onchain?: LegStatus; // create an ONCHAIN leg with this status
  fiat?: { status: LegStatus; bankRef: string }; // create a FIAT leg
  receipt?: "fiat" | "pool";
}

async function seedRichDemo(ctx: { tenantId: string; adminUserId: string; viewKeyMaterial: Buffer }) {
  const { tenantId, adminUserId, viewKeyMaterial } = ctx;
  let ledger = 3_500_000;

  // --- Idempotent cleanup (delete demo-marked rows; cascades legs + receipts) ---
  await prisma.payment.deleteMany({ where: { intentId: { startsWith: DEMO_INTENT_PREFIX } } });
  await prisma.paymentBatch.deleteMany({ where: { id: DEMO_BATCH_ID } });
  await prisma.receiver.deleteMany({ where: { id: { in: RECEIVERS.map((r) => r.id) } } });
  await prisma.auditLog.deleteMany({ where: { tenantId, ip: DEMO_AUDIT_IP } });

  // --- Member user + receiver personas ---
  const memberHash = await argon2.hash(MEMBER_PASSWORD, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { username: MEMBER_USERNAME },
    update: { role: "MEMBER", tenantId, passwordHash: memberHash },
    create: { username: MEMBER_USERNAME, role: "MEMBER", tenantId, passwordHash: memberHash },
  });

  const receiverIds: Record<string, string> = {};
  for (const r of RECEIVERS) {
    const hash = await argon2.hash(r.password, { type: argon2.argon2id });
    const rec = await prisma.receiver.create({ data: { id: r.id, email: r.email, passwordHash: hash } });
    receiverIds[r.email] = rec.id;
  }

  // --- mkPayment: create a payment + its legs + its receipt from a spec ---
  const fiatReceiptJson = (p: { id: string; createdAt: Date; proofHash: string | null; shielded: boolean }, s: PaymentSpec, txHash: string, lgr: number) => ({
    id: `rcpt_demo_${s.suffix}`,
    paymentId: p.id,
    status: "settled",
    created: p.createdAt.toISOString(),
    corridor: { from: s.corridorFrom, to: s.corridorTo },
    amounts: {
      source: { currency: s.sourceAsset, value: Number(s.sourceAmount).toFixed(2) },
      destination: { currency: s.targetCurrency, value: Number(s.targetAmount ?? s.sourceAmount).toFixed(2) },
    },
    fx: { rate: Number(quoteFxRate(s.corridorFrom, s.corridorTo) ?? "1").toFixed(2), asOf: p.createdAt.toISOString() },
    fees: { network: "0.00041 XLM", anchor: `${s.targetCurrency} 50.00`, platform: "0.00" },
    slippage: "0.0000",
    onchain: { txHash, ledger: lgr, proofHash: p.proofHash ?? "", asset: s.sourceAsset },
    fiat: { provider: "mock-anchor", reference: `demo-${s.suffix}`, bankRef: s.fiat?.bankRef ?? "" },
    privacy: { shielded: p.shielded, viewKeyDisclosed: false },
  });

  const poolReceiptJson = (p: { id: string; createdAt: Date; shielded: boolean }, s: PaymentSpec, txHash: string, lgr: number) => ({
    id: `rcpt_demo_${s.suffix}`,
    paymentId: p.id,
    status: "settled",
    rail: "pool-wallet",
    created: p.createdAt.toISOString(),
    corridor: { from: s.corridorFrom, to: s.corridorTo },
    amounts: {
      source: { currency: "XLM", value: Number(s.sourceAmount).toFixed(7) },
      destination: { currency: "XLM", value: Number(s.sourceAmount).toFixed(7) },
    },
    onchain: { txHash, ledger: lgr, nullifierHash: "", asset: "XLM" },
    privacy: { shielded: p.shielded, viewKeyDisclosed: false },
  });

  const created: { spec: PaymentSpec; id: string }[] = [];

  const mkPayment = async (s: PaymentSpec): Promise<string> => {
    const intentId = DEMO_INTENT_PREFIX + s.suffix;
    const txHash = demoTx(s.suffix);
    const lgr = (ledger += 137);

    let encryptedPayload: Uint8Array<ArrayBuffer> | undefined;
    let payloadNonce: Uint8Array<ArrayBuffer> | undefined;
    let proofHash: string | undefined;
    if (s.shield) {
      const blob = aesEncrypt(
        Buffer.from(
          JSON.stringify({
            sender: s.shield.sender,
            recipient: s.shield.recipient,
            asset: s.sourceAsset,
            amount: s.sourceAmount,
            targetCurrency: s.targetCurrency,
            intentId,
          }),
          "utf8",
        ),
        viewKeyMaterial,
      );
      encryptedPayload = blob.ciphertext;
      payloadNonce = blob.nonce;
      proofHash = hexCommitment(deriveCommitment(viewKeyMaterial, intentId).commitment);
    }

    const p = await prisma.payment.create({
      data: {
        tenantId,
        intentId,
        status: s.status,
        createdAt: s.createdAt,
        sourceAsset: s.sourceAsset,
        sourceAmount: s.sourceAmount,
        targetCurrency: s.targetCurrency,
        targetAmount: s.targetAmount,
        corridorFrom: s.corridorFrom,
        corridorTo: s.corridorTo,
        recipientRef: s.recipientRef,
        shielded: Boolean(s.shield),
        encryptedPayload,
        payloadNonce,
        proofHash,
        payoutMethod: s.payoutMethod,
        batchId: s.batchId,
        receiverId: s.receiverId,
        poolCommitment: s.poolCommitment,
        poolNullifierHash: s.status === "SETTLED" && s.payoutMethod ? demoTx(`${s.suffix}_nul`).slice(0, 32) : undefined,
      },
    });

    if (s.onchain) {
      await prisma.paymentLeg.create({
        data: {
          paymentId: p.id,
          legType: "ONCHAIN",
          status: s.onchain,
          txHash,
          ledger: lgr,
          contractId: process.env.POOL_CONTRACT_ID ?? "DEMO_CONTRACT",
        },
      });
    }
    if (s.fiat) {
      await prisma.paymentLeg.create({
        data: {
          paymentId: p.id,
          legType: "FIAT",
          status: s.fiat.status,
          bankRef: s.fiat.bankRef,
          amount: s.targetAmount,
          currency: s.targetCurrency,
          provider: "mock-anchor",
          providerRef: `demo-${s.suffix}`,
          receivedAt: s.fiat.status === "RECEIVED" ? s.createdAt : undefined,
        },
      });
    }
    if (s.receipt === "fiat") {
      await prisma.receipt.create({ data: { paymentId: p.id, json: fiatReceiptJson(p, s, txHash, lgr) } });
    } else if (s.receipt === "pool") {
      await prisma.receipt.create({ data: { paymentId: p.id, json: poolReceiptJson(p, s, txHash, lgr) } });
    }

    created.push({ spec: s, id: p.id });
    return p.id;
  };

  const usdPhp = (usd: string): string => quoteTargetAmount(usd, "USD", "PHP") ?? "0";
  const xlmPhp = (xlm: string): string => quoteTargetAmount(xlm, "XLM", "PHP") ?? "0";

  // --- Standalone payments across every status + both rails ---
  const fiat1 = await mkPayment({
    suffix: "fiat_settled_1", status: "SETTLED", createdAt: daysBefore(40),
    sourceAsset: "USDC", sourceAmount: "1500.00", targetCurrency: "PHP", targetAmount: usdPhp("1500.00"),
    corridorFrom: "USD", corridorTo: "PHP", recipientRef: "Contractor A (Cebu)",
    shield: { sender: "Trexure HQ", recipient: "Contractor A (Cebu)" },
    onchain: "CONFIRMED", fiat: { status: "RECEIVED", bankRef: "BDO-DEMO-1500" }, receipt: "fiat",
  });
  await mkPayment({
    suffix: "fiat_settled_2", status: "SETTLED", createdAt: daysBefore(25),
    sourceAsset: "USDC", sourceAmount: "3200.00", targetCurrency: "PHP", targetAmount: usdPhp("3200.00"),
    corridorFrom: "USD", corridorTo: "PHP", recipientRef: "Studio Bravo Inc",
    shield: { sender: "Trexure HQ", recipient: "Studio Bravo Inc" },
    onchain: "CONFIRMED", fiat: { status: "RECEIVED", bankRef: "GCASH-DEMO-3200" }, receipt: "fiat",
  });
  await mkPayment({
    suffix: "pool_settled_1", status: "SETTLED", createdAt: daysBefore(18),
    sourceAsset: "XLM", sourceAmount: "120.0000000", targetCurrency: "XLM", targetAmount: "120.0000000",
    corridorFrom: "XLM", corridorTo: "XLM", recipientRef: "Private wallet transfer",
    payoutMethod: "POOL_WALLET", shield: { sender: "Trexure HQ", recipient: "Private wallet transfer" },
    onchain: "CONFIRMED", receipt: "pool",
  });
  await mkPayment({
    suffix: "poolbank_settled_1", status: "SETTLED", createdAt: daysBefore(12),
    sourceAsset: "XLM", sourceAmount: "200.0000000", targetCurrency: "PHP", targetAmount: xlmPhp("200"),
    corridorFrom: "XLM", corridorTo: "PHP", recipientRef: "Freelancer off-ramp (PDAX)",
    payoutMethod: "POOL_BANK", shield: { sender: "Trexure HQ", recipient: "Freelancer off-ramp (PDAX)" },
    onchain: "CONFIRMED", fiat: { status: "RECEIVED", bankRef: "PDAX-DEMO-200" }, receipt: "fiat",
  });

  // Exceptions the reconciliation report chases:
  await mkPayment({
    suffix: "pending_1", status: "PENDING", createdAt: daysBefore(3),
    sourceAsset: "USDC", sourceAmount: "800.00", targetCurrency: "PHP", targetAmount: usdPhp("800.00"),
    corridorFrom: "USD", corridorTo: "PHP", recipientRef: "Contractor C (Davao)",
    shield: { sender: "Trexure HQ", recipient: "Contractor C (Davao)" }, onchain: "PENDING",
  });
  await mkPayment({
    suffix: "onchain_drift_1", status: "ONCHAIN_CONFIRMED", createdAt: daysBefore(5),
    sourceAsset: "USDC", sourceAmount: "950.00", targetCurrency: "PHP", targetAmount: usdPhp("950.00"),
    corridorFrom: "USD", corridorTo: "PHP", recipientRef: "Vendor D (awaiting fiat)",
    shield: { sender: "Trexure HQ", recipient: "Vendor D (awaiting fiat)" }, onchain: "CONFIRMED",
  });
  await mkPayment({
    suffix: "reconciling_1", status: "RECONCILING", createdAt: daysBefore(2),
    sourceAsset: "USDC", sourceAmount: "1750.00", targetCurrency: "PHP", targetAmount: usdPhp("1750.00"),
    corridorFrom: "USD", corridorTo: "PHP", recipientRef: "Vendor E (matching)",
    shield: { sender: "Trexure HQ", recipient: "Vendor E (matching)" },
    onchain: "CONFIRMED", fiat: { status: "PENDING", bankRef: "PENDING-DEMO-1750" },
  });
  await mkPayment({
    suffix: "failed_custody_1", status: "FAILED", createdAt: daysBefore(4),
    sourceAsset: "XLM", sourceAmount: "90.0000000", targetCurrency: "PHP", targetAmount: xlmPhp("90"),
    corridorFrom: "XLM", corridorTo: "PHP", recipientRef: "Off-ramp failed (custody)",
    payoutMethod: "POOL_BANK", shield: { sender: "Trexure HQ", recipient: "Off-ramp failed (custody)" },
    onchain: "CONFIRMED",
  });
  await mkPayment({
    suffix: "draft_1", status: "DRAFT", createdAt: daysBefore(1),
    sourceAsset: "USDC", sourceAmount: "500.00", targetCurrency: "PHP", targetAmount: usdPhp("500.00"),
    corridorFrom: "USD", corridorTo: "PHP", recipientRef: "Draft vendor (not submitted)",
  });

  // --- A batch (#80) with claimed + unclaimed disbursements ---
  const batchChildren: PaymentSpec[] = [
    {
      suffix: "batch_claim_wallet_1", status: "SETTLED", createdAt: daysBefore(20), batchId: DEMO_BATCH_ID,
      sourceAsset: "XLM", sourceAmount: "15.0000000", targetCurrency: "XLM", targetAmount: "15.0000000",
      corridorFrom: "XLM", corridorTo: "XLM", recipientRef: RECEIVERS[0].label, receiverId: receiverIds[RECEIVERS[0].email],
      payoutMethod: "POOL_WALLET", poolCommitment: demoTx("batch_claim_wallet_1_c").slice(0, 40),
      shield: { sender: "Trexure HQ", recipient: RECEIVERS[0].label }, onchain: "CONFIRMED", receipt: "pool",
    },
    {
      suffix: "batch_claim_wallet_2", status: "SETTLED", createdAt: daysBefore(20), batchId: DEMO_BATCH_ID,
      sourceAsset: "XLM", sourceAmount: "22.0000000", targetCurrency: "XLM", targetAmount: "22.0000000",
      corridorFrom: "XLM", corridorTo: "XLM", recipientRef: RECEIVERS[1].label, receiverId: receiverIds[RECEIVERS[1].email],
      payoutMethod: "POOL_WALLET", poolCommitment: demoTx("batch_claim_wallet_2_c").slice(0, 40),
      shield: { sender: "Trexure HQ", recipient: RECEIVERS[1].label }, onchain: "CONFIRMED", receipt: "pool",
    },
    {
      suffix: "batch_claim_bank_1", status: "SETTLED", createdAt: daysBefore(20), batchId: DEMO_BATCH_ID,
      sourceAsset: "XLM", sourceAmount: "30.0000000", targetCurrency: "PHP", targetAmount: xlmPhp("30"),
      corridorFrom: "XLM", corridorTo: "PHP", recipientRef: RECEIVERS[2].label, receiverId: receiverIds[RECEIVERS[2].email],
      payoutMethod: "POOL_BANK", poolCommitment: demoTx("batch_claim_bank_1_c").slice(0, 40),
      shield: { sender: "Trexure HQ", recipient: RECEIVERS[2].label },
      onchain: "CONFIRMED", fiat: { status: "RECEIVED", bankRef: "PDAX-DEMO-BATCH-30" }, receipt: "fiat",
    },
    {
      suffix: "batch_unclaimed_1", status: "PENDING", createdAt: daysBefore(20), batchId: DEMO_BATCH_ID,
      sourceAsset: "XLM", sourceAmount: "18.0000000", targetCurrency: "XLM", targetAmount: "18.0000000",
      corridorFrom: "XLM", corridorTo: "XLM", recipientRef: "Unclaimed freelancer #1",
      payoutMethod: "POOL_WALLET", poolCommitment: demoTx("batch_unclaimed_1_c").slice(0, 40),
      shield: { sender: "Trexure HQ", recipient: "Unclaimed freelancer #1" },
    },
    {
      suffix: "batch_unclaimed_2", status: "PENDING", createdAt: daysBefore(20), batchId: DEMO_BATCH_ID,
      sourceAsset: "XLM", sourceAmount: "12.0000000", targetCurrency: "XLM", targetAmount: "12.0000000",
      corridorFrom: "XLM", corridorTo: "XLM", recipientRef: "Unclaimed freelancer #2",
      payoutMethod: "POOL_WALLET", poolCommitment: demoTx("batch_unclaimed_2_c").slice(0, 40),
      shield: { sender: "Trexure HQ", recipient: "Unclaimed freelancer #2" },
    },
  ];
  const batchTotal = batchChildren.reduce((a, c) => a + Number(c.sourceAmount), 0);
  await prisma.paymentBatch.create({
    data: {
      id: DEMO_BATCH_ID,
      tenantId,
      createdByUserId: adminUserId,
      count: batchChildren.length,
      totalSourceAmount: batchTotal.toFixed(7),
      createdAt: daysBefore(20),
    },
  });
  for (const child of batchChildren) await mkPayment(child);

  // --- Audit trail (marked with ip=DEMO_AUDIT_IP for idempotent cleanup) ---
  const auditRows = [
    { action: "auth.login", userId: adminUserId, target: null as string | null, createdAt: daysBefore(1, 8), metadata: { username: process.env.SEED_ADMIN_USERNAME ?? "admin" } },
    { action: "viewkey.decrypt", userId: adminUserId, target: fiat1, createdAt: daysBefore(1, 10), metadata: { report: "disclosure" } },
    { action: "report.generate", userId: adminUserId, target: "reconciliation", createdAt: daysBefore(0, 9), metadata: { report: "reconciliation", format: "csv" } },
    { action: "auth.login", userId: adminUserId, target: null, createdAt: daysBefore(2, 8), metadata: { username: MEMBER_USERNAME } },
  ];
  for (const a of auditRows) {
    await prisma.auditLog.create({
      data: { tenantId, userId: a.userId, action: a.action, target: a.target ?? undefined, metadata: a.metadata, ip: DEMO_AUDIT_IP, createdAt: a.createdAt },
    });
  }

  const settledCount = created.filter((c) => c.spec.status === "SETTLED").length;
  const batchClaimed = batchChildren.filter((c) => c.status === "SETTLED").length;
  return {
    paymentCount: created.length,
    settledCount,
    exceptionCount: created.length - settledCount,
    batchClaimed,
    batchUnclaimed: batchChildren.length - batchClaimed,
    auditCount: auditRows.length,
  };
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  });

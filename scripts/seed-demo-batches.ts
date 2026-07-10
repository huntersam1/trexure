import "dotenv/config";
import * as crypto from "node:crypto";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Additive demo-batch seeder for the Disbursement / Payroll Register + flow map.
 *
 * The app seed (`prisma/seed.ts`) creates a single batch; the register/flow map
 * look much richer with several dated batches spanning wallet / bank / pending /
 * failed destinations. This script ONLY adds rows marked with the prefixes
 * below, so it never touches the app seed's data and is idempotent (a re-run
 * deletes its own marked rows first, then recreates them).
 *
 * Target tenant is the app seed's demo tenant. Run against staging with:
 *   DATABASE_URL="<staging url>" tsx --conditions=react-server scripts/seed-demo-batches.ts
 * Pass --check to only print current counts without writing.
 */

const TENANT_ID = "seed_tenant_trexure_hq";
const INTENT_PREFIX = "intent_demo_flow_";
const BATCH_PREFIX = "seed_flow_batch_";
const BASE = new Date(process.env.SEED_BASE_DATE ?? "2026-07-10T12:00:00.000Z");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function daysBefore(n: number, hour = 10): Date {
  const d = new Date(BASE);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}
function hx(seed: string, len: number): string {
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, len);
}

type Dest = "WALLET" | "BANK" | "PENDING_WALLET" | "PENDING_BANK" | "FAILED";

interface Child {
  receiver: string;
  amount: string; // XLM
  dest: Dest;
}
interface BatchSpec {
  id: string;
  label: string; // for logging only; PaymentBatch has no name column
  daysAgo: number;
  children: Child[];
}

// Five batches within the current month (so the report's default month scope
// shows them all), on distinct days, each a different destination mix.
const BATCHES: BatchSpec[] = [
  {
    id: BATCH_PREFIX + "p1",
    label: "Payroll — week 1",
    daysAgo: 9,
    children: [
      { receiver: "Maria Santos", amount: "420.0000000", dest: "WALLET" },
      { receiver: "Jose Cruz", amount: "380.0000000", dest: "WALLET" },
      { receiver: "Ana Reyes", amount: "510.0000000", dest: "WALLET" },
      { receiver: "Paolo Mendoza", amount: "295.0000000", dest: "WALLET" },
      { receiver: "Bituin Aquino", amount: "610.0000000", dest: "BANK" },
      { receiver: "Datu Lim", amount: "450.0000000", dest: "BANK" },
      { receiver: "Liwayway Tan", amount: "330.0000000", dest: "PENDING_WALLET" },
      { receiver: "Ramon Dela Cruz", amount: "275.0000000", dest: "PENDING_WALLET" },
    ],
  },
  {
    id: BATCH_PREFIX + "vendors",
    label: "Vendor payouts",
    daysAgo: 7,
    children: [
      { receiver: "Acme Hosting Corp", amount: "900.0000000", dest: "BANK" },
      { receiver: "Bright Studio Inc", amount: "740.0000000", dest: "BANK" },
      { receiver: "Northwind Supplies", amount: "1200.0000000", dest: "BANK" },
      { receiver: "Cebu Print Works", amount: "560.0000000", dest: "BANK" },
      { receiver: "Legacy Freight Ltd", amount: "480.0000000", dest: "FAILED" },
      { receiver: "devshop.io", amount: "650.0000000", dest: "WALLET" },
    ],
  },
  {
    id: BATCH_PREFIX + "bonuses",
    label: "Contractor bonuses",
    daysAgo: 5,
    children: [
      { receiver: "Iris Uy", amount: "320.0000000", dest: "WALLET" },
      { receiver: "Ben Enriquez", amount: "300.0000000", dest: "WALLET" },
      { receiver: "Grace Villar", amount: "410.0000000", dest: "WALLET" },
      { receiver: "Tomas Reyes", amount: "365.0000000", dest: "WALLET" },
      { receiver: "Kim Ferrer", amount: "290.0000000", dest: "WALLET" },
      { receiver: "Sol Bautista", amount: "260.0000000", dest: "PENDING_WALLET" },
      { receiver: "Miggy Torres", amount: "340.0000000", dest: "PENDING_WALLET" },
    ],
  },
  {
    id: BATCH_PREFIX + "retainers",
    label: "Retainers",
    daysAgo: 3,
    children: [
      { receiver: "Studio K", amount: "600.0000000", dest: "WALLET" },
      { receiver: "Harbor Media", amount: "580.0000000", dest: "WALLET" },
      { receiver: "PDAX Off-ramp — Vendor F", amount: "820.0000000", dest: "BANK" },
      { receiver: "PDAX Off-ramp — Vendor G", amount: "760.0000000", dest: "BANK" },
      { receiver: "Sunrise Logistics", amount: "540.0000000", dest: "FAILED" },
    ],
  },
  {
    id: BATCH_PREFIX + "p2",
    label: "Payroll — week 2",
    daysAgo: 1,
    children: [
      { receiver: "Maria Santos", amount: "440.0000000", dest: "WALLET" },
      { receiver: "Jose Cruz", amount: "400.0000000", dest: "WALLET" },
      { receiver: "Ana Reyes", amount: "520.0000000", dest: "WALLET" },
      { receiver: "Paolo Mendoza", amount: "310.0000000", dest: "WALLET" },
      { receiver: "Bituin Aquino", amount: "630.0000000", dest: "BANK" },
      { receiver: "Datu Lim", amount: "470.0000000", dest: "BANK" },
      { receiver: "Liwayway Tan", amount: "350.0000000", dest: "PENDING_WALLET" },
      { receiver: "Ramon Dela Cruz", amount: "285.0000000", dest: "PENDING_BANK" },
      { receiver: "Noel Garcia", amount: "360.0000000", dest: "PENDING_WALLET" },
    ],
  },
];

const PHP_PER_XLM = 6.4;

async function currentState() {
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  const batches = await prisma.paymentBatch.count({ where: { tenantId: TENANT_ID } });
  const flowBatches = await prisma.paymentBatch.count({
    where: { tenantId: TENANT_ID, id: { startsWith: BATCH_PREFIX } },
  });
  const inBatches = await prisma.payment.count({
    where: { tenantId: TENANT_ID, batchId: { not: null } },
  });
  return { tenantFound: !!tenant, tenantName: tenant?.name, batches, flowBatches, paymentsInBatches: inBatches };
}

async function main() {
  const check = process.argv.includes("--check");

  const before = await currentState();
  console.log("BEFORE:", JSON.stringify(before));
  if (!before.tenantFound) {
    throw new Error(
      `Tenant ${TENANT_ID} not found — run the app seed (pnpm db:seed) against this database first.`,
    );
  }
  if (check) {
    await prisma.$disconnect();
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { tenantId: TENANT_ID, role: "ADMIN" },
    orderBy: { username: "asc" },
  });
  if (!admin) throw new Error(`No ADMIN user for tenant ${TENANT_ID}.`);

  // Idempotent cleanup of THIS script's marked rows only (legs + receipts cascade off payments).
  await prisma.payment.deleteMany({ where: { tenantId: TENANT_ID, intentId: { startsWith: INTENT_PREFIX } } });
  await prisma.paymentBatch.deleteMany({ where: { tenantId: TENANT_ID, id: { startsWith: BATCH_PREFIX } } });

  let totalChildren = 0;
  const tally: Record<Dest, number> = { WALLET: 0, BANK: 0, PENDING_WALLET: 0, PENDING_BANK: 0, FAILED: 0 };

  for (const b of BATCHES) {
    const createdAt = daysBefore(b.daysAgo);
    const total = b.children.reduce((a, c) => a + Number(c.amount), 0);

    await prisma.paymentBatch.create({
      data: {
        id: b.id,
        tenantId: TENANT_ID,
        createdByUserId: admin.id,
        count: b.children.length,
        totalSourceAmount: total.toFixed(7),
        createdAt,
      },
    });

    for (let i = 0; i < b.children.length; i++) {
      const c = b.children[i]!;
      const suffix = `${b.id}_${i}`;
      const intentId = INTENT_PREFIX + suffix;
      const isBank = c.dest === "BANK" || c.dest === "PENDING_BANK";
      const isSettled = c.dest === "WALLET" || c.dest === "BANK";
      const isFailed = c.dest === "FAILED";
      const payoutMethod = isBank ? "POOL_BANK" : "POOL_WALLET";
      const status = isSettled ? "SETTLED" : isFailed ? "FAILED" : "PENDING";
      const targetCurrency = isBank ? "PHP" : "XLM";
      const targetAmount = isBank ? (Number(c.amount) * PHP_PER_XLM).toFixed(2) : c.amount;
      const txHash = hx("tx_" + suffix, 64);

      const p = await prisma.payment.create({
        data: {
          tenantId: TENANT_ID,
          intentId,
          status: status as never,
          createdAt,
          sourceAsset: "XLM",
          sourceAmount: c.amount,
          targetCurrency,
          targetAmount,
          corridorFrom: "XLM",
          corridorTo: targetCurrency,
          recipientRef: c.receiver,
          shielded: false,
          payoutMethod: payoutMethod as never,
          batchId: b.id,
          poolCommitment: hx("commit_" + suffix, 40),
          poolNullifierHash: isSettled ? hx("nul_" + suffix, 32) : undefined,
        },
      });

      // ONCHAIN leg carries the withdraw/settlement tx (wallet leaf detail + failed rows have one too).
      if (isSettled || isFailed) {
        await prisma.paymentLeg.create({
          data: {
            paymentId: p.id,
            legType: "ONCHAIN",
            status: (isFailed ? "CONFIRMED" : "CONFIRMED") as never,
            txHash,
            ledger: 4_000_000 + totalChildren,
            contractId: process.env.POOL_CONTRACT_ID ?? "DEMO_CONTRACT",
          },
        });
      }
      // FIAT leg gives bank rows their destination bank ref.
      if (isBank && isSettled) {
        await prisma.paymentLeg.create({
          data: {
            paymentId: p.id,
            legType: "FIAT",
            status: "RECEIVED" as never,
            bankRef: `${["BPI", "UBP", "BDO", "PNB"][i % 4]}···${hx("bank_" + suffix, 4)}`,
            amount: targetAmount,
            currency: targetCurrency,
            provider: "mock-anchor",
            providerRef: `demo-${suffix}`,
            receivedAt: createdAt,
          },
        });
      }
      // Settled rows get a human receipt id so the register's Receipt column populates.
      if (isSettled) {
        await prisma.receipt.create({
          data: {
            paymentId: p.id,
            json: { id: `rcpt_flow_${suffix}`, paymentId: p.id, status: "settled" } as never,
          },
        });
      }

      tally[c.dest]++;
      totalChildren++;
    }
    console.log(`  + batch ${b.label}: ${b.children.length} disbursements, ${total.toFixed(2)} XLM, ${createdAt.toISOString().slice(0, 10)}`);
  }

  const after = await currentState();
  console.log("AFTER:", JSON.stringify(after));
  console.log(
    `Added ${BATCHES.length} batches / ${totalChildren} disbursements — ` +
      `wallet ${tally.WALLET}, bank ${tally.BANK}, pending ${tally.PENDING_WALLET + tally.PENDING_BANK}, failed ${tally.FAILED}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

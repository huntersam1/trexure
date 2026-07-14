// Seed a deterministic Treasury Float Yield demo scenario for the HQ tenant, so
// the /yield dashboard + /reports/yield attribution report show realistic numbers
// in the demo recording. Idempotent: demo rows (intentId prefix `intent_yielddemo_`)
// are deleted + recreated each run; the HQ yield config is upserted to the demo
// values. Run BEFORE record-yield.mjs. Requires the dev DB up.
//
// Usage: tsx --conditions=react-server scripts/seed-yield-demo.mts
import "dotenv/config";
process.env.ENABLE_YIELD = "true";

const TENANT = process.env.SEED_ADMIN_TENANT_ID || "seed_tenant_trexure_hq";
const PREFIX = "intent_yielddemo_";

type Spec = {
  ref: string;
  status: "SWEPT_IN" | "SWEPT_OUT";
  principal: string;
  accrued?: string;
  fee?: string;
  day: string; // ISO date within the current-month default range
};

// 2 positions still in yield (idle float earning) + 2 unwound (yield realized).
const SPECS: Spec[] = [
  { ref: "Vendor payroll — batch", status: "SWEPT_IN", principal: "4200", day: "2026-07-11" },
  { ref: "Contractor run", status: "SWEPT_IN", principal: "2300", day: "2026-07-12" },
  { ref: "Q1 supplier settlement", status: "SWEPT_OUT", principal: "4000", accrued: "40", fee: "0.1", day: "2026-07-06" },
  { ref: "Ad-spend reimbursement", status: "SWEPT_OUT", principal: "2000", accrued: "20", fee: "0.05", day: "2026-07-08" },
];

async function main() {
  const { prisma } = await import("../lib/db");
  const { saveYieldConfig } = await import("../lib/yield/config");
  const { createHash } = await import("node:crypto");
  const tx = (s: string) => createHash("sha256").update(`yielddemo:${s}`).digest("hex");

  // Clean prior demo rows (positions cascade with their payments).
  const prior = await prisma.payment.findMany({
    where: { tenantId: TENANT, intentId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const priorIds = prior.map((p) => p.id);
  if (priorIds.length) {
    await prisma.yieldPosition.deleteMany({ where: { paymentId: { in: priorIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: priorIds } } });
  }

  // Enable + configure yield for the demo (100 USDC liquid buffer, 25 bps fee).
  await saveYieldConfig(TENANT, {
    enabled: true,
    minIdleBuffer: "100",
    sweepThreshold: "0",
    feeBps: "25",
  });

  for (const s of SPECS) {
    const intentId = `${PREFIX}${s.ref.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    const createdAt = new Date(`${s.day}T09:00:00.000Z`);
    const pay = await prisma.payment.create({
      data: {
        tenantId: TENANT,
        intentId,
        status: s.status === "SWEPT_OUT" ? "SETTLED" : "PENDING",
        sourceAsset: "USDC",
        sourceAmount: (Number(s.principal) + 100).toFixed(2), // principal + buffer
        targetCurrency: "PHP",
        corridorFrom: "USD",
        corridorTo: "PHP",
        recipientRef: s.ref,
        createdAt,
      } as never,
    });
    await prisma.yieldPosition.create({
      data: {
        tenantId: TENANT,
        paymentId: pay.id,
        status: s.status,
        yieldAsset: "YLDS",
        principal: s.principal,
        accruedYield: s.accrued ?? "0",
        feeBps: "25",
        feeAmount: s.fee ?? "0",
        sweepInTxHash: tx(`in:${intentId}`),
        sweepInLedger: 1000000 + s.ref.length,
        sweepOutTxHash: s.status === "SWEPT_OUT" ? tx(`out:${intentId}`) : null,
        sweepOutLedger: s.status === "SWEPT_OUT" ? 1000500 + s.ref.length : null,
        createdAt,
        updatedAt: createdAt,
      } as never,
    });
  }

  console.log(`Seeded ${SPECS.length} yield positions for ${TENANT} (in-yield 6500, accrued 60, fee 0.15).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

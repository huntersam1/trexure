import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import {
  buildAttestation,
  verifyAttestation,
  attestationToJson,
  attestationToPdf,
  type Attestation,
} from "./attestation";

const TENANT = "test_tenant_attest_r4";
const OTHER = "test_tenant_attest_r4_other";
const NOW = new Date("2026-07-31T23:59:59.999Z");

type Leg = { legType: "ONCHAIN" | "FIAT"; status?: string; txHash?: string; ledger?: number; bankRef?: string };

async function payment(opts: {
  tenantId: string;
  intent: string;
  status: string;
  recipientRef?: string;
  payoutMethod?: string;
  proofHash?: string;
  legs?: Leg[];
  receiptJson?: Record<string, unknown>;
}): Promise<string> {
  const p = await prisma.payment.create({
    data: {
      tenantId: opts.tenantId,
      intentId: opts.intent,
      status: opts.status as never,
      sourceAsset: "XLM",
      sourceAmount: "100",
      targetCurrency: "PHP",
      targetAmount: "5670",
      corridorFrom: "XLM",
      corridorTo: "PHP",
      recipientRef: opts.recipientRef ?? "Acme Vendor",
      payoutMethod: (opts.payoutMethod as never) ?? null,
      proofHash: opts.proofHash ?? null,
      legs: opts.legs
        ? {
            create: opts.legs.map((l) => ({
              legType: l.legType as never,
              status: (l.status ?? "CONFIRMED") as never,
              txHash: l.txHash ?? null,
              ledger: l.ledger ?? null,
              bankRef: l.bankRef ?? null,
            })),
          }
        : undefined,
    } as never,
  });
  if (opts.receiptJson) {
    await prisma.receipt.create({ data: { paymentId: p.id, json: opts.receiptJson as never } });
  }
  return p.id;
}

let fiatId: string;
let poolId: string;
let pendingId: string;
let otherId: string;

beforeAll(async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: `Attest ${id}` } });
  }

  fiatId = await payment({
    tenantId: TENANT,
    intent: "att_fiat",
    status: "SETTLED",
    recipientRef: "Acme Vendor",
    proofHash: "0xprooffiat",
    legs: [
      { legType: "ONCHAIN", txHash: "tx_fiat", ledger: 123 },
      { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-REF-FIAT" },
    ],
    receiptJson: {
      id: "rcpt_fiat",
      created: "2026-07-10T10:00:00.000Z",
      amounts: { source: { currency: "XLM", value: "100.00" }, destination: { currency: "PHP", value: "5670.00" } },
      fx: { rate: "56.70" },
      onchain: { txHash: "tx_fiat", ledger: 123, proofHash: "0xprooffiat" },
      fiat: { bankRef: "BANK-REF-FIAT" },
    },
  });

  poolId = await payment({
    tenantId: TENANT,
    intent: "att_pool",
    status: "SETTLED",
    recipientRef: "Freelancer A",
    payoutMethod: "POOL_WALLET",
    legs: [{ legType: "ONCHAIN", txHash: "tx_pool", ledger: 456 }],
    receiptJson: {
      id: "rcpt_pool",
      rail: "pool-wallet",
      created: "2026-07-11T10:00:00.000Z",
      amounts: { source: { currency: "XLM", value: "5.0000000" }, destination: { currency: "XLM", value: "5.0000000" } },
      onchain: { txHash: "tx_pool", ledger: 456 },
    },
  });

  pendingId = await payment({ tenantId: TENANT, intent: "att_pending", status: "PENDING" });
  otherId = await payment({
    tenantId: OTHER,
    intent: "att_other",
    status: "SETTLED",
    legs: [{ legType: "ONCHAIN", txHash: "tx_other" }],
  });
});

afterAll(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("buildAttestation", () => {
  it("assembles a fiat attestation from the stored receipt + legs", async () => {
    const att = await buildAttestation(TENANT, fiatId, NOW);
    expect(att.rail).toBe("fiat");
    expect(att.counterparty).toBe("Acme Vendor");
    expect(att.source).toEqual({ currency: "XLM", value: "100.00" });
    expect(att.destination).toEqual({ currency: "PHP", value: "5670.00" });
    expect(att.fxRate).toBe("56.70");
    expect(att.txHash).toBe("tx_fiat");
    expect(att.txUrl).toBe("https://stellar.expert/explorer/testnet/tx/tx_fiat");
    expect(att.proofHash).toBe("0xprooffiat");
    expect(att.ledger).toBe("123");
    expect(att.bankRef).toBe("BANK-REF-FIAT");
    expect(att.receiptId).toBe("rcpt_fiat");
    expect(att.legs.map((l) => l.legType).sort()).toEqual(["FIAT", "ONCHAIN"]);
  });

  it("assembles an on-chain-only pool-wallet attestation (no fiat/fx)", async () => {
    const att = await buildAttestation(TENANT, poolId, NOW);
    expect(att.rail).toBe("pool-wallet");
    expect(att.fxRate).toBe("");
    expect(att.bankRef).toBe("");
    expect(att.txHash).toBe("tx_pool");
    expect(att.receiptId).toBe("rcpt_pool");
  });

  it("signs the payment facts so the document verifies (and tampering is detected)", async () => {
    const att = await buildAttestation(TENANT, fiatId, NOW);
    expect(att.signature.alg).toBe("HMAC-SHA256");
    expect(att.signature.value).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAttestation(att)).toBe(true);

    // Tamper with a signed fact — verification must fail.
    const tampered: Attestation = { ...att, source: { ...att.source, value: "999999.00" } };
    expect(verifyAttestation(tampered)).toBe(false);

    // issuedAt is NOT a signed fact — changing it does not break the signature.
    const reissued: Attestation = { ...att, issuedAt: "2027-01-01T00:00:00.000Z" };
    expect(verifyAttestation(reissued)).toBe(true);
  });

  it("refuses a non-settled payment with 409", async () => {
    await expect(buildAttestation(TENANT, pendingId, NOW)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses a cross-tenant / unknown payment with 404", async () => {
    await expect(buildAttestation(TENANT, otherId, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(buildAttestation(TENANT, "nope", NOW)).rejects.toBeInstanceOf(AppError);
  });

  it("renders JSON and a PDF", async () => {
    const att = await buildAttestation(TENANT, fiatId, NOW);
    const parsed = JSON.parse(attestationToJson(att));
    expect(parsed.paymentId).toBe(fiatId);
    expect(parsed.signature.value).toBe(att.signature.value);

    const pdf = await attestationToPdf(att);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });
});

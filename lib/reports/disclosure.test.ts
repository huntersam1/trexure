import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { storeViewKey } from "@/lib/crypto/viewkey";
import {
  buildDisclosurePack,
  previewDisclosureScope,
  disclosurePackToCsv,
  disclosurePackToJson,
  type DisclosurePack,
} from "./disclosure";
import type { DateRange } from "./scope";

const TENANT = "test_tenant_disc_r2";
const OTHER = "test_tenant_disc_r2_other";
const ACTOR = "u_disc_admin";

const VIEW_KEY = Buffer.alloc(32, 7); // deterministic tenant view key for the test

const RANGE: DateRange = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.999Z"),
};
const IN_RANGE = new Date("2026-07-10T09:00:00.000Z");
const OUT_OF_RANGE = new Date("2026-06-15T09:00:00.000Z");
const NOW = new Date("2026-07-31T23:59:59.999Z");

// Encrypt exactly as lib/zk `gcmEncrypt` does (aes-256-gcm, 12-byte nonce,
// ciphertext = enc||tag) so `decryptWithViewKey` round-trips in the builder.
function shieldPayload(obj: Record<string, unknown>): { encryptedPayload: Buffer; payloadNonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", VIEW_KEY, nonce);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), "utf8")), cipher.final()]);
  return { encryptedPayload: Buffer.concat([enc, cipher.getAuthTag()]), payloadNonce: nonce };
}

async function payment(opts: {
  tenantId: string;
  intent: string;
  status: string;
  createdAt: Date;
  recipientRef: string;
  proofHash?: string;
  shieldObj?: Record<string, unknown>;
  legs?: { legType: "ONCHAIN" | "FIAT"; status?: string; txHash?: string; bankRef?: string }[];
  receiptJson?: Record<string, unknown>;
}): Promise<string> {
  const blob = opts.shieldObj ? shieldPayload(opts.shieldObj) : null;
  const p = await prisma.payment.create({
    data: {
      tenantId: opts.tenantId,
      intentId: opts.intent,
      status: opts.status as never,
      createdAt: opts.createdAt,
      sourceAsset: "XLM",
      sourceAmount: "100",
      targetCurrency: "PHP",
      targetAmount: "5670",
      corridorFrom: "XLM",
      corridorTo: "PHP",
      recipientRef: opts.recipientRef,
      proofHash: opts.proofHash ?? null,
      encryptedPayload: (blob?.encryptedPayload ?? null) as never,
      payloadNonce: (blob?.payloadNonce ?? null) as never,
      legs: opts.legs
        ? {
            create: opts.legs.map((l) => ({
              legType: l.legType as never,
              status: (l.status ?? "PENDING") as never,
              txHash: l.txHash ?? null,
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

let shieldedId: string;

beforeAll(async () => {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: "Disc HQ" } });
  await prisma.tenant.upsert({ where: { id: OTHER }, update: {}, create: { id: OTHER, name: "Other Co" } });
  await storeViewKey(TENANT, VIEW_KEY);

  // Shielded + settled payment with proof + both legs + receipt (fx/bankRef).
  shieldedId = await payment({
    tenantId: TENANT,
    intent: "disc_shielded_1",
    status: "SETTLED",
    createdAt: IN_RANGE,
    recipientRef: "Acme Vendor",
    proofHash: "0xproofacme",
    shieldObj: {
      sender: "Disc HQ",
      recipient: "Acme Vendor Ltd",
      asset: "XLM",
      amount: "100",
      targetCurrency: "PHP",
      intentId: "disc_shielded_1",
      memo: "July retainer",
    },
    legs: [
      { legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_acme_onchain" },
      { legType: "FIAT", status: "RECEIVED", bankRef: "BANK-REF-ACME" },
    ],
    receiptJson: {
      id: "rcpt_acme",
      fx: { rate: "56.70" },
      onchain: { txHash: "tx_acme_onchain" },
      fiat: { bankRef: "BANK-REF-ACME" },
    },
  });

  // Second shielded payment, different counterparty (for the filter test).
  await payment({
    tenantId: TENANT,
    intent: "disc_shielded_2",
    status: "SETTLED",
    createdAt: IN_RANGE,
    recipientRef: "Beta Studio",
    proofHash: "0xproofbeta",
    shieldObj: {
      sender: "Disc HQ",
      recipient: "Beta Studio",
      asset: "XLM",
      amount: "50",
      targetCurrency: "PHP",
      intentId: "disc_shielded_2",
    },
    legs: [{ legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_beta_onchain" }],
  });

  // Non-shielded payment (still listed, disclosed=null).
  await payment({
    tenantId: TENANT,
    intent: "disc_clear",
    status: "PENDING",
    createdAt: IN_RANGE,
    recipientRef: "Cleartext Co",
  });

  // Out-of-range (excluded).
  await payment({
    tenantId: TENANT,
    intent: "disc_june",
    status: "SETTLED",
    createdAt: OUT_OF_RANGE,
    recipientRef: "June Vendor",
    shieldObj: { sender: "Disc HQ", recipient: "June Vendor", asset: "XLM", amount: "1", targetCurrency: "PHP", intentId: "disc_june" },
  });

  // Other tenant's shielded payment (must never appear / never decrypt).
  await payment({
    tenantId: OTHER,
    intent: "disc_other",
    status: "SETTLED",
    createdAt: IN_RANGE,
    recipientRef: "Acme Vendor",
    shieldObj: { sender: "Other Co", recipient: "Secret", asset: "XLM", amount: "9", targetCurrency: "PHP", intentId: "disc_other" },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.receipt.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.paymentLeg.deleteMany({ where: { payment: { tenantId: { in: [TENANT, OTHER] } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.viewKey.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
  await prisma.$disconnect();
});

describe("buildDisclosurePack", () => {
  let pack: DisclosurePack;
  beforeAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT } });
    pack = await buildDisclosurePack(TENANT, RANGE, { actorUserId: ACTOR }, NOW);
  });

  it("reveals a shielded payment's details under the tenant view key", () => {
    const e = pack.entries.find((x) => x.paymentId === shieldedId)!;
    expect(e.disclosed).not.toBeNull();
    expect(e.disclosed!.recipient).toBe("Acme Vendor Ltd");
    expect(e.disclosed!.amount).toBe("100");
    expect(e.disclosed!.memo).toBe("July retainer");
    expect(e.disclosureNote).toContain("Revealed");
  });

  it("attaches on-chain proof (proofHash + stellar.expert link) and settlement legs", () => {
    const e = pack.entries.find((x) => x.paymentId === shieldedId)!;
    expect(e.proofHash).toBe("0xproofacme");
    expect(e.txHash).toBe("tx_acme_onchain");
    expect(e.txUrl).toBe("https://stellar.expert/explorer/testnet/tx/tx_acme_onchain");
    expect(e.legs.map((l) => l.legType).sort()).toEqual(["FIAT", "ONCHAIN"]);
    expect(e.fxRate).toBe("56.70");
    expect(e.bankRef).toBe("BANK-REF-ACME");
    expect(e.receiptId).toBe("rcpt_acme");
  });

  it("lists a non-shielded payment without revealing (disclosed=null + note)", () => {
    const e = pack.entries.find((x) => x.counterparty === "Cleartext Co")!;
    expect(e.disclosed).toBeNull();
    expect(e.disclosureNote).toContain("Not shielded");
  });

  it("excludes out-of-range payments and is tenant-isolated", () => {
    const refs = pack.entries.map((e) => e.counterparty);
    expect(refs).not.toContain("June Vendor");
    // OTHER tenant also used recipientRef "Acme Vendor"; ensure its secret is unseen.
    for (const e of pack.entries) {
      expect(e.disclosed?.recipient).not.toBe("Secret");
    }
    expect(pack.paymentCount).toBe(3);
    expect(pack.revealedCount).toBe(2);
  });

  it("writes one viewkey.decrypt audit row per reveal plus a pack-level report.disclosure row", async () => {
    const decrypts = await prisma.auditLog.count({
      where: { tenantId: TENANT, action: "viewkey.decrypt", userId: ACTOR },
    });
    const packRows = await prisma.auditLog.count({
      where: { tenantId: TENANT, action: "report.disclosure", userId: ACTOR },
    });
    expect(decrypts).toBe(2);
    expect(packRows).toBe(1);
  });

  it("filters to a single counterparty when requested", async () => {
    const scoped = await buildDisclosurePack(TENANT, RANGE, { counterparty: "Beta Studio", actorUserId: ACTOR }, NOW);
    expect(scoped.entries).toHaveLength(1);
    expect(scoped.counterparty).toBe("Beta Studio");
    expect(scoped.entries[0]!.disclosed!.recipient).toBe("Beta Studio");
  });
});

describe("previewDisclosureScope", () => {
  it("counts payments and shielded payments without decrypting or auditing", async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT } });
    const scope = await previewDisclosureScope(TENANT, RANGE);
    expect(scope.paymentCount).toBe(3);
    expect(scope.shieldedCount).toBe(2);
    expect(scope.counterparties).toEqual(["Acme Vendor", "Beta Studio", "Cleartext Co"]);
    const audits = await prisma.auditLog.count({ where: { tenantId: TENANT } });
    expect(audits).toBe(0);
  });
});

describe("audit trail (fail-closed)", () => {
  it("stamps every viewkey.decrypt row with the caller IP", async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT } });
    await buildDisclosurePack(TENANT, RANGE, { actorUserId: ACTOR, ip: "203.0.113.7" }, NOW);
    const rows = await prisma.auditLog.findMany({
      where: { tenantId: TENANT, action: "viewkey.decrypt" },
      select: { ip: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ip === "203.0.113.7")).toBe(true);
  });
});

describe("disclosure renderers", () => {
  it("renders a CSV appendix with a header and a revealed row", async () => {
    const pack = await buildDisclosurePack(TENANT, RANGE, { actorUserId: ACTOR }, NOW);
    const csv = disclosurePackToCsv(pack);
    expect(csv.split("\r\n")[0]).toContain("Proof Hash");
    expect(csv).toContain("Acme Vendor Ltd");
    expect(csv).toContain("0xproofacme");
  });

  it("renders parseable JSON with the pack contents", async () => {
    const pack = await buildDisclosurePack(TENANT, RANGE, { actorUserId: ACTOR }, NOW);
    const parsed = JSON.parse(disclosurePackToJson(pack));
    expect(parsed.revealedCount).toBe(2);
    expect(parsed.entries).toHaveLength(3);
  });
});

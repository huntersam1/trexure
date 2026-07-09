import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { createClaimLink, revealClaimLink, emailClaimLink } from "@/lib/receiver/claim-link";

const TENANT = "test_tenant_claimlink";
const NOTE = "trexure-note-v1-" + "a".repeat(192);

async function makePayment(suffix: string, amount = "10") {
  return prisma.payment.create({
    data: {
      tenantId: TENANT,
      intentId: `intent_claimlink_${suffix}`,
      status: "PENDING",
      sourceAsset: "XLM",
      sourceAmount: amount,
      targetCurrency: "XLM",
      corridorFrom: "XLM",
      corridorTo: "XLM",
      recipientRef: "ref",
    },
  });
}

beforeAll(async () => {
  await prisma.tenant.upsert({
    where: { id: TENANT },
    update: {},
    create: { id: TENANT, name: "Acme Payer" },
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } }); // cascades ClaimLink
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

describe("claim links (#81)", () => {
  it("round-trips the note behind the token and stores only ciphertext", async () => {
    const payment = await makePayment("rt");
    const token = await createClaimLink(payment.id, NOTE, "off@example.com");

    // Persisted blob must NOT contain the plaintext note.
    const row = await prisma.claimLink.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(Buffer.from(row.encryptedNote).toString("utf8")).not.toContain(NOTE);
    expect(row.revealedAt).toBeNull();

    const revealed = await revealClaimLink(token);
    expect(revealed?.note).toBe(NOTE);
    expect(revealed?.payment.sourceAmount).toBe("10");
    expect(revealed?.payment.payerName).toBe("Acme Payer");

    // Reveal stamps revealedAt.
    const after = await prisma.claimLink.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(after.revealedAt).not.toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await revealClaimLink("not-a-real-token")).toBeNull();
    expect(await revealClaimLink("")).toBeNull();
  });

  it("returns null when the ciphertext is tampered (fails closed)", async () => {
    const payment = await makePayment("tamper");
    const token = await createClaimLink(payment.id, NOTE, "off@example.com");

    const row = await prisma.claimLink.findUniqueOrThrow({ where: { paymentId: payment.id } });
    const bytes = Buffer.from(row.encryptedNote);
    bytes[0] = bytes[0]! ^ 0xff; // flip a byte
    await prisma.claimLink.update({
      where: { paymentId: payment.id },
      data: { encryptedNote: bytes as unknown as Uint8Array<ArrayBuffer> },
    });

    expect(await revealClaimLink(token)).toBeNull();
  });

  it("returns null once the link has expired", async () => {
    const payment = await makePayment("expired");
    const token = await createClaimLink(payment.id, NOTE, "off@example.com");
    await prisma.claimLink.update({
      where: { paymentId: payment.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await revealClaimLink(token)).toBeNull();
  });

  it("emails the link and records send status via the mock provider", async () => {
    const payment = await makePayment("email");
    const sent = await emailClaimLink({
      paymentId: payment.id,
      note: NOTE,
      email: "off@example.com",
      payerName: "Acme Payer",
      amount: "10",
      asset: "XLM",
    });
    expect(sent).toBe(true);

    const row = await prisma.claimLink.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(row.sentAt).not.toBeNull();
    expect(row.providerRef).toMatch(/^mock_email_/);
  });
});

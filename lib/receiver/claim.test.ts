import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

// Mock the network + ZK withdraw and the mock-anchor HTTP hop; the DB, reconcile
// matcher, and receipt builder all run for real.
const { createPoolWithdraw, triggerMockPayout } = vi.hoisted(() => ({
  createPoolWithdraw: vi.fn(),
  triggerMockPayout: vi.fn(),
}));
vi.mock("@/lib/pool/service", () => ({
  createPoolWithdraw,
  custodyAddress: () => "GCUSTODYTEST0000000000000000000000000000000000000000000",
}));
vi.mock("@/lib/anchor/mock", () => ({ triggerMockPayout }));

import { prisma } from "@/lib/db";
import { submitClaim } from "@/lib/receiver/claim";
import { generateNote, serializeNote } from "@/lib/pool/note";
import { AppError } from "@/lib/http/problem";

const TENANT = "test_tenant_claim_p4";
const USER = "test_user_claim_p4";
const hex32 = (x: bigint) => "0x" + x.toString(16).padStart(64, "0");
const G = Keypair.random().publicKey();

// A note + its matching disbursement Payment.
const note = generateNote(10_000_000n);
const noteString = serializeNote(note);
const commitment = hex32(note.commitment);

let receiverId: string;
let paymentId: string;

async function seed() {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: TENANT } });
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: USER, passwordHash: "x" },
  });
  const receiver = await prisma.receiver.upsert({
    where: { email: "claim_p4@example.com" },
    update: {},
    create: { email: "claim_p4@example.com", passwordHash: "x" },
  });
  receiverId = receiver.id;

  // Fresh disbursement each run (unique intentId), matching the note's commitment.
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  const p = await prisma.payment.create({
    data: {
      tenantId: TENANT,
      intentId: `intent_claim_p4_${note.commitment.toString(16).slice(0, 12)}`,
      status: "PENDING",
      payoutMethod: "POOL_WALLET",
      sourceAsset: "XLM",
      sourceAmount: "10",
      targetCurrency: "XLM",
      corridorFrom: "XLM",
      corridorTo: "XLM",
      recipientRef: "Alice",
      shielded: true,
      poolCommitment: commitment,
    } as never,
  });
  paymentId = p.id;
}

beforeEach(async () => {
  createPoolWithdraw.mockReset().mockResolvedValue({
    txHash: "txwithdraw1",
    ledger: 99,
    explorerUrl: "https://stellar.expert/explorer/testnet/tx/txwithdraw1",
  });
  // Default mock off-ramp: write a successful FIAT leg (what the signed webhook
  // does), keyed by intentId, with the amount the caller quoted.
  triggerMockPayout.mockReset().mockImplementation(
    async ({ intentId, amount, currency }: { intentId: string; amount: string; currency: string }) => {
      const p = await prisma.payment.findUniqueOrThrow({ where: { intentId } });
      const legData = {
        status: "RECEIVED" as const,
        provider: "mock-anchor",
        providerRef: "mock_ref_1",
        bankRef: "PH-BANK-TEST",
        amount,
        currency,
        receivedAt: new Date(),
      };
      await prisma.paymentLeg.upsert({
        where: { paymentId_legType: { paymentId: p.id, legType: "FIAT" } },
        create: { paymentId: p.id, legType: "FIAT", ...legData },
        update: legData,
      });
      return { providerRef: "mock_ref_1", bankRef: "PH-BANK-TEST", status: "completed" as const };
    },
  );
  await seed();
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.receiver.deleteMany({ where: { email: "claim_p4@example.com" } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

describe("wallet claim (P4)", () => {
  it("withdraws, writes the ONCHAIN leg, settles, and builds an on-chain-only receipt", async () => {
    const res = await submitClaim(receiverId, { note: noteString, payout: { method: "wallet", address: G } });

    expect(res.method).toBe("wallet");
    expect(res.txHash).toBe("txwithdraw1");
    expect(res.paymentId).toBe(paymentId);
    // On-chain-only receipt shape: no fiat block, rail marker, XLM→XLM.
    const receipt = res.receipt as { rail: string; amounts: { destination: unknown }; onchain: { txHash: string } };
    expect(receipt.rail).toBe("pool-wallet");
    expect(res.receipt).not.toHaveProperty("fiat");
    expect(receipt.amounts.destination).toEqual({ currency: "XLM", value: "10.0000000" });
    expect(receipt.onchain.txHash).toBe("txwithdraw1");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { legs: true } });
    expect(payment.status).toBe("SETTLED");
    expect(payment.poolNullifierHash).toBe(hex32(note.nullifierHash));
    expect(payment.receiverId).toBe(receiverId);
    const onchain = payment.legs.find((l) => l.legType === "ONCHAIN");
    expect(onchain?.status).toBe("CONFIRMED");
    expect(onchain?.txHash).toBe("txwithdraw1");

    const receiptRow = await prisma.receipt.findUnique({ where: { paymentId } });
    expect(receiptRow).not.toBeNull();
  });

  it("clears an in-app claim notification for the disbursement on success (#82)", async () => {
    await prisma.notification.create({ data: { receiverId, paymentId, type: "CLAIM" } });

    await submitClaim(receiverId, { note: noteString, payout: { method: "wallet", address: G } });

    const notif = await prisma.notification.findFirstOrThrow({ where: { paymentId } });
    expect(notif.claimedAt).not.toBeNull();
    expect(notif.readAt).not.toBeNull();
  });

  it("rejects a double-claim (409) without withdrawing again", async () => {
    await submitClaim(receiverId, { note: noteString, payout: { method: "wallet", address: G } });
    expect(createPoolWithdraw).toHaveBeenCalledTimes(1);

    await expect(
      submitClaim(receiverId, { note: noteString, payout: { method: "wallet", address: G } }),
    ).rejects.toMatchObject({ status: 409 });
    // The spent-nullifier pre-check short-circuits before any second withdraw.
    expect(createPoolWithdraw).toHaveBeenCalledTimes(1);
  });

  it("404s when no disbursement matches the note", async () => {
    const orphan = serializeNote(generateNote(5_000_000n));
    await expect(
      submitClaim(receiverId, { note: orphan, payout: { method: "wallet", address: G } }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      submitClaim(receiverId, { note: orphan, payout: { method: "wallet", address: G } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(createPoolWithdraw).not.toHaveBeenCalled();
  });
});

const BANK = { method: "bank" as const, bankCode: "BDO", accountName: "Alice Dev", accountNumber: "0012345678" };

describe("bank claim (P5)", () => {
  it("withdraws to custody, off-ramps, reconciles both legs → SETTLED + fiat receipt", async () => {
    const res = await submitClaim(receiverId, { note: noteString, payout: BANK });

    expect(res.method).toBe("bank");
    expect(res.txHash).toBe("txwithdraw1");
    expect(triggerMockPayout).toHaveBeenCalledTimes(1);
    // The off-ramp was quoted the PHP target (10 XLM × 6.24) and paid the bank.
    expect(triggerMockPayout).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "62.40", currency: "PHP", recipientRef: "BDO/0012345678" }),
    );

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { legs: true } });
    expect(payment.status).toBe("SETTLED");
    expect(payment.payoutMethod).toBe("POOL_BANK");
    expect(payment.corridorTo).toBe("PHP");
    expect(payment.targetAmount?.toString()).toBe("62.4");
    expect(payment.legs.find((l) => l.legType === "ONCHAIN")?.status).toBe("CONFIRMED");
    expect(payment.legs.find((l) => l.legType === "FIAT")?.status).toBe("RECEIVED");

    // Fiat receipt: fiat block populated with the bank ref.
    const receipt = res.receipt as { fiat: { bankRef: string }; amounts: { destination: { currency: string } } };
    expect(receipt.fiat.bankRef).toBe("PH-BANK-TEST");
    expect(receipt.amounts.destination.currency).toBe("PHP");
  });

  it("routes an off-ramp failure after withdraw to FAILED + 502 (custody holds XLM)", async () => {
    // Override once: the payout fails → FAILED FIAT leg + payment FAILED (webhook behavior).
    triggerMockPayout.mockImplementationOnce(async ({ intentId }: { intentId: string }) => {
      const p = await prisma.payment.findUniqueOrThrow({ where: { intentId } });
      await prisma.paymentLeg.upsert({
        where: { paymentId_legType: { paymentId: p.id, legType: "FIAT" } },
        create: { paymentId: p.id, legType: "FIAT", status: "FAILED", provider: "mock-anchor", providerRef: "r", bankRef: "b" },
        update: { status: "FAILED" },
      });
      await prisma.payment.update({ where: { id: p.id }, data: { status: "FAILED" } });
      return { providerRef: "r", bankRef: "b", status: "failed" as const };
    });

    await expect(submitClaim(receiverId, { note: noteString, payout: BANK })).rejects.toMatchObject({ status: 502 });

    // The withdraw already happened (ONCHAIN leg present); payment is FAILED, not SETTLED.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { legs: true } });
    expect(payment.status).toBe("FAILED");
    expect(payment.legs.find((l) => l.legType === "ONCHAIN")?.status).toBe("CONFIRMED");
    expect(createPoolWithdraw).toHaveBeenCalledTimes(1);
  });
});

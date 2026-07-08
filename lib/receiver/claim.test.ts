import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

// Mock the network + ZK withdraw; everything else (DB, receipt) runs for real.
const { createPoolWithdraw } = vi.hoisted(() => ({ createPoolWithdraw: vi.fn() }));
vi.mock("@/lib/pool/service", () => ({ createPoolWithdraw }));

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
    expect(res.receipt?.rail).toBe("pool-wallet");
    expect(res.receipt).not.toHaveProperty("fiat");
    expect(res.receipt?.amounts.destination).toEqual({ currency: "XLM", value: "10.0000000" });
    expect(res.receipt?.onchain.txHash).toBe("txwithdraw1");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { legs: true } });
    expect(payment.status).toBe("SETTLED");
    expect(payment.poolNullifierHash).toBe(hex32(note.nullifierHash));
    expect(payment.receiverId).toBe(receiverId);
    const onchain = payment.legs.find((l) => l.legType === "ONCHAIN");
    expect(onchain?.status).toBe("CONFIRMED");
    expect(onchain?.txHash).toBe("txwithdraw1");

    const receipt = await prisma.receipt.findUnique({ where: { paymentId } });
    expect(receipt).not.toBeNull();
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

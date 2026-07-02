import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "../../../lib/generated/prisma/client";

const buildAndSubmit = vi.fn();
const shield = vi.fn();
const addWatch = vi.fn(async () => ({ id: "job1" }));
const addReconcile = vi.fn(async () => ({ id: "job2" }));

vi.mock("../../../lib/stellar/client", () => ({ buildAndSubmitPrivatePayment: buildAndSubmit }));
vi.mock("../../../lib/zk", () => ({ shield }));
vi.mock("../../../lib/queue", () => ({
  QUEUE: { WATCH_ONCHAIN: "watch-onchain", RECONCILE: "reconcile" },
  watchOnchainQueue: { add: addWatch },
  reconcileQueue: { add: addReconcile },
  redisConnection: {},
}));

import { resetDb, seedTenant, prismaForTest } from "../../helpers/db";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  shield.mockResolvedValue({
    encryptedPayload: Buffer.from("enc"),
    payloadNonce: Buffer.from("noncenonce12"),
    proofHash: "a".repeat(64),
  });
  buildAndSubmit.mockResolvedValue({ txHash: "tx_1", ledger: 100, contractId: "CCONTRACT" });
});

describe("createPayment", () => {
  it("creates a PENDING payment + ONCHAIN leg, stores amount as Decimal, enqueues watch-onchain", async () => {
    const { tenantId } = await seedTenant("Acme");
    const { createPayment } = await import("../../../lib/payments/service");

    const res = await createPayment(tenantId, {
      recipientRef: "rcp_1", amount: "2500.00", sourceAsset: "USDC",
      targetCurrency: "PHP", anchorId: "anchor_1",
    });

    expect(res.status).toBe("PENDING");
    expect(res.intentId).toMatch(/^intent_/);
    expect(addWatch).toHaveBeenCalledWith("watch-onchain", { paymentId: res.id });
    // The on-chain submission records the payment's proofHash as the commitment (#31).
    expect(buildAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ commitment: "a".repeat(64) }),
    );

    const row = await prismaForTest.payment.findUnique({
      where: { id: res.id }, include: { legs: true },
    });
    // Stored as Prisma.Decimal, NOT a JS number.
    expect(row!.sourceAmount).toBeInstanceOf(Prisma.Decimal);
    expect(row!.sourceAmount.toString()).toBe("2500");
    expect(row!.corridorFrom).toBe("USD");
    expect(row!.corridorTo).toBe("PHP");
    expect(row!.proofHash).toBe("a".repeat(64));
    expect(row!.legs).toHaveLength(1);
    expect(row!.legs[0]!.legType).toBe("ONCHAIN");
    expect(row!.legs[0]!.txHash).toBe("tx_1");
  });

  it("generates a unique intentId per payment", async () => {
    const { tenantId } = await seedTenant("Acme");
    const { createPayment } = await import("../../../lib/payments/service");
    const base = { recipientRef: "r", amount: "10.00", sourceAsset: "USDC", targetCurrency: "PHP", anchorId: "a" };
    const a = await createPayment(tenantId, base);
    const b = await createPayment(tenantId, base);
    expect(a.intentId).not.toBe(b.intentId);
  });
});

describe("getPaymentById / listPayments tenant scoping", () => {
  it("throws 404 when reading another tenant's payment", async () => {
    const { tenantId: t1 } = await seedTenant("T1");
    const { tenantId: t2 } = await seedTenant("T2");
    const { createPayment, getPaymentById } = await import("../../../lib/payments/service");
    const p = await createPayment(t1, { recipientRef: "r", amount: "1.00", sourceAsset: "USDC", targetCurrency: "PHP", anchorId: "a" });
    await expect(getPaymentById(t2, p.id)).rejects.toMatchObject({ status: 404 });
  });

  it("listPayments only returns the caller tenant's rows", async () => {
    const { tenantId: t1 } = await seedTenant("T1");
    const { tenantId: t2 } = await seedTenant("T2");
    const { createPayment, listPayments } = await import("../../../lib/payments/service");
    await createPayment(t1, { recipientRef: "r", amount: "1.00", sourceAsset: "USDC", targetCurrency: "PHP", anchorId: "a" });
    const out = await listPayments(t2, { limit: 20 });
    expect(out.items).toHaveLength(0);
  });
});

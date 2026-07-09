import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock the network-hitting deposit + the contract-id lookup so the service test
// exercises only persistence + partial-failure logic against the real DB.
const { createPoolDeposit } = vi.hoisted(() => ({ createPoolDeposit: vi.fn() }));
vi.mock("@/lib/pool/service", () => ({ createPoolDeposit }));
vi.mock("@/lib/pool/sync", () => ({ poolContractId: () => "CPOOLTEST" }));

import { prisma } from "@/lib/db";
import { createPoolBatch } from "@/lib/pool/batch";

const TENANT = "test_tenant_batch_p2";
const USER = "test_user_batch_p2";
const RECEIVER = "test_receiver_batch_p2";
const RECEIVER_EMAIL = "batch-onplatform@example.com";

// A deposit that mints a deterministic note per amount; amount 999 blows up to
// exercise partial-failure.
function depositFor(amount: number) {
  if (amount === 999) throw new Error("simulated deposit failure");
  return {
    note: `trexure-note-v1-${amount}`,
    commitment: `0xcommit${amount}`,
    amount,
    txHash: `tx${amount}`,
    ledger: 1,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/tx${amount}`,
  };
}

beforeAll(async () => {
  await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, name: TENANT } });
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: { id: USER, tenantId: TENANT, username: USER, passwordHash: "x" },
  });
  await prisma.receiver.upsert({
    where: { id: RECEIVER },
    update: {},
    create: { id: RECEIVER, email: RECEIVER_EMAIL, passwordHash: "x" },
  });
  createPoolDeposit.mockImplementation(async ({ amount }: { amount: number }) => depositFor(amount));
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { receiverId: RECEIVER } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.paymentBatch.deleteMany({ where: { tenantId: TENANT } });
  await prisma.receiver.deleteMany({ where: { id: RECEIVER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

describe("createPoolBatch", () => {
  it("creates a PaymentBatch + N child Payments and returns N notes", async () => {
    const res = await createPoolBatch(TENANT, USER, {
      receivers: [
        { amount: 10, ref: "Alice", email: "alice@example.com" },
        { amount: 5, ref: "Bob" },
      ],
    });

    expect(res.count).toBe(2);
    expect(res.requested).toBe(2);
    expect(res.totalSourceAmount).toBe(15);
    expect(res.results.filter((r) => r.ok)).toHaveLength(2);
    expect(res.results.map((r) => (r.ok ? r.note : null))).toEqual([
      "trexure-note-v1-10",
      "trexure-note-v1-5",
    ]);

    // Batch roll-up persisted and scoped to the tenant.
    const batch = await prisma.paymentBatch.findUniqueOrThrow({ where: { id: res.batchId } });
    expect(batch.tenantId).toBe(TENANT);
    expect(batch.createdByUserId).toBe(USER);
    expect(batch.count).toBe(2);
    expect(batch.totalSourceAmount.toString()).toBe("15");

    // Child payments carry the pool fields; no plaintext note is stored.
    const children = await prisma.payment.findMany({ where: { batchId: res.batchId }, orderBy: { recipientRef: "asc" } });
    expect(children).toHaveLength(2);
    for (const c of children) {
      expect(c.tenantId).toBe(TENANT);
      expect(c.payoutMethod).toBe("POOL_WALLET");
      expect(c.status).toBe("PENDING");
      expect(c.poolCommitment).toMatch(/^0xcommit/);
      expect(c.encryptedNote).toBeNull();
    }
  });

  it("reports partial failures per-row without discarding successful notes", async () => {
    const res = await createPoolBatch(TENANT, USER, {
      receivers: [
        { amount: 7, ref: "Carol" },
        { amount: 999, ref: "Dave" }, // this deposit throws
        { amount: 3, ref: "Erin" },
      ],
    });

    expect(res.requested).toBe(3);
    expect(res.count).toBe(2); // only the two that succeeded
    expect(res.totalSourceAmount).toBe(10);

    const dave = res.results.find((r) => r.ref === "Dave")!;
    expect(dave.ok).toBe(false);
    if (!dave.ok) expect(dave.error).toMatch(/simulated deposit failure/);

    // The successful rows still produced notes + persisted payments.
    const good = res.results.filter((r) => r.ok);
    expect(good.map((r) => r.ref)).toEqual(["Carol", "Erin"]);
    const persisted = await prisma.payment.count({ where: { batchId: res.batchId } });
    expect(persisted).toBe(2);
  });

  it("notifies an on-platform receiver in-app and skips an off-platform one (#82)", async () => {
    const res = await createPoolBatch(TENANT, USER, {
      receivers: [
        { amount: 4, ref: "OnPlatform", email: RECEIVER_EMAIL.toUpperCase() }, // case-insensitive match
        { amount: 6, ref: "OffPlatform", email: "stranger@example.com" },
        { amount: 8, ref: "NoEmail" },
      ],
    });

    const onP = res.results.find((r) => r.ref === "OnPlatform")!;
    const offP = res.results.find((r) => r.ref === "OffPlatform")!;
    const noEmail = res.results.find((r) => r.ref === "NoEmail")!;
    expect(onP.ok && onP.notifiedInApp).toBe(true);
    expect(offP.ok && offP.notifiedInApp).toBe(false);
    expect(noEmail.ok && noEmail.notifiedInApp).toBe(false);

    // Exactly the matched receiver's payment produced a notification.
    const notifs = await prisma.notification.findMany({ where: { receiverId: RECEIVER } });
    expect(notifs).toHaveLength(1);
    expect(onP.ok && notifs[0]!.paymentId).toBe(onP.ok ? onP.paymentId : undefined);
  });
});

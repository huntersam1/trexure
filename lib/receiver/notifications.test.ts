import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import {
  createClaimNotification,
  listNotificationsForReceiver,
  countUnreadForReceiver,
  markAllReadForReceiver,
  markNotificationsClaimedForPayment,
} from "@/lib/receiver/notifications";

const TENANT = "test_tenant_notif";
const RECEIVER = "test_receiver_notif";

async function makePayment(intentSuffix: string, amount: string) {
  return prisma.payment.create({
    data: {
      tenantId: TENANT,
      intentId: `intent_notif_${intentSuffix}`,
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
  await prisma.receiver.upsert({
    where: { id: RECEIVER },
    update: {},
    create: { id: RECEIVER, email: "notif-receiver@example.com", passwordHash: "x" },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { receiverId: RECEIVER } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.receiver.deleteMany({ where: { id: RECEIVER } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

describe("receiver notifications (#82)", () => {
  it("creates a notification, idempotently, and exposes payment context", async () => {
    const payment = await makePayment("a", "10");
    await createClaimNotification(RECEIVER, payment.id);
    await createClaimNotification(RECEIVER, payment.id); // retry — must not duplicate

    const list = await listNotificationsForReceiver(RECEIVER);
    const forPayment = list.filter((n) => n.paymentId === payment.id);
    expect(forPayment).toHaveLength(1);
    expect(forPayment[0]!.read).toBe(false);
    expect(forPayment[0]!.claimed).toBe(false);
    expect(forPayment[0]!.payment.sourceAmount).toBe("10");
    expect(forPayment[0]!.payment.payerName).toBe("Acme Payer");
  });

  it("counts unread and clears it on mark-all-read", async () => {
    const before = await countUnreadForReceiver(RECEIVER);
    expect(before).toBeGreaterThanOrEqual(1);

    const cleared = await markAllReadForReceiver(RECEIVER);
    expect(cleared).toBe(before);
    expect(await countUnreadForReceiver(RECEIVER)).toBe(0);
  });

  it("marks notifications claimed for a settled payment (and re-read)", async () => {
    const payment = await makePayment("b", "7");
    await createClaimNotification(RECEIVER, payment.id);
    expect(await countUnreadForReceiver(RECEIVER)).toBe(1);

    await markNotificationsClaimedForPayment(payment.id);

    const list = await listNotificationsForReceiver(RECEIVER);
    const claimed = list.find((n) => n.paymentId === payment.id)!;
    expect(claimed.claimed).toBe(true);
    expect(claimed.read).toBe(true);
    expect(await countUnreadForReceiver(RECEIVER)).toBe(0);
  });
});

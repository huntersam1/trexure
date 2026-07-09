import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/log";

/**
 * In-app claim notifications (#82, follow-up to batch epic #80). A `Notification`
 * links a global `Receiver` to a disbursement `Payment` so an on-platform
 * receiver sees "you have a payment to claim" on login instead of relying purely
 * on an out-of-band note. These are global (not tenant-scoped), so every helper
 * uses the plain `prisma` client — never `forTenant`.
 *
 * Privacy: a notification references the disbursement only. The bearer note is
 * never persisted anywhere, so it is never in a notification either — the
 * receiver still supplies the note (delivered privately) to actually claim.
 */

export type ReceiverNotification = {
  id: string;
  paymentId: string;
  read: boolean;
  claimed: boolean;
  createdAt: Date;
  payment: {
    sourceAmount: string;
    sourceAsset: string;
    status: string;
    batchId: string | null;
    payerName: string;
  };
};

/**
 * Create the in-app notification for a receiver/payment pair. Idempotent: a
 * repeat (e.g. a batch retry) is a no-op thanks to the `@@unique([receiverId,
 * paymentId])` constraint, so it never double-notifies.
 */
export async function createClaimNotification(receiverId: string, paymentId: string): Promise<void> {
  await prisma.notification.upsert({
    where: { receiverId_paymentId: { receiverId, paymentId } },
    update: {}, // never resurrect a claimed/read one
    create: { receiverId, paymentId, type: "CLAIM" },
  });
}

/** All notifications for a receiver, newest first, with just enough payment context. */
export async function listNotificationsForReceiver(receiverId: string): Promise<ReceiverNotification[]> {
  const rows = await prisma.notification.findMany({
    where: { receiverId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      paymentId: true,
      readAt: true,
      claimedAt: true,
      createdAt: true,
      payment: {
        select: {
          sourceAmount: true,
          sourceAsset: true,
          status: true,
          batchId: true,
          tenant: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    paymentId: r.paymentId,
    read: r.readAt !== null,
    claimed: r.claimedAt !== null,
    createdAt: r.createdAt,
    payment: {
      sourceAmount: r.payment.sourceAmount.toString(),
      sourceAsset: r.payment.sourceAsset,
      status: r.payment.status,
      batchId: r.payment.batchId,
      payerName: r.payment.tenant.name,
    },
  }));
}

/** Count of unread notifications — drives the inbox badge. */
export async function countUnreadForReceiver(receiverId: string): Promise<number> {
  return prisma.notification.count({ where: { receiverId, readAt: { equals: null } } });
}

/** Mark every unread notification for a receiver as read (inbox "mark all read"). */
export async function markAllReadForReceiver(receiverId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { receiverId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}

/**
 * Clear the notification(s) for a claimed disbursement — called from the claim
 * flow once a payment settles. Marks them claimed + read so the inbox reflects
 * "already claimed" and the unread badge drops. Best-effort: a failure here must
 * never fail an otherwise-successful claim, so the caller wraps it.
 */
export async function markNotificationsClaimedForPayment(paymentId: string): Promise<void> {
  const now = new Date();
  const res = await prisma.notification.updateMany({
    where: { paymentId, claimedAt: null },
    data: { claimedAt: now, readAt: now },
  });
  if (res.count > 0) logger.info({ paymentId, cleared: res.count }, "claim notifications cleared");
}

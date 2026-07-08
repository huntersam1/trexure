import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import { RECEIVER_SESSION_COOKIE_NAME } from "./cookie";

/**
 * Receiver session (P3, #85) — a parallel to lib/auth/session.ts for the global
 * `Receiver` persona, backed by the `ReceiverSession` table and its own cookie.
 * Same sliding + absolute TTL policy; deliberately isolated from the tenant
 * `User` session so a receiver can never reach the tenant `(app)` shell (and
 * vice-versa) on the strength of the wrong cookie.
 */
export type SessionReceiver = { id: string; email: string };

const SLIDING_TTL_MS = 1000 * 60 * 60 * 24; // 24h sliding window
const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d hard cap

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/", // required for __Host- prefix; never set Domain.
    maxAge: maxAgeSec,
  };
}

export async function createReceiverSession(receiverId: string, ip?: string, ua?: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SLIDING_TTL_MS);
  await prisma.receiverSession.create({ data: { receiverId, tokenHash, expiresAt, ip, userAgent: ua } });
  const store = await cookies();
  store.set(RECEIVER_SESSION_COOKIE_NAME, token, cookieOptions(Math.floor(ABSOLUTE_TTL_MS / 1000)));
}

export async function getReceiver(): Promise<SessionReceiver | null> {
  const store = await cookies();
  const token = store.get(RECEIVER_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.receiverSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { receiver: { select: { id: true, email: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  const absoluteExpiry = session.createdAt.getTime() + ABSOLUTE_TTL_MS;
  if (session.expiresAt.getTime() <= now || now >= absoluteExpiry) {
    await prisma.receiverSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const renewed = Math.min(now + SLIDING_TTL_MS, absoluteExpiry);
  if (renewed > session.expiresAt.getTime()) {
    await prisma.receiverSession.update({ where: { id: session.id }, data: { expiresAt: new Date(renewed) } });
  }

  return session.receiver as SessionReceiver;
}

export async function destroyReceiverSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(RECEIVER_SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.receiverSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(RECEIVER_SESSION_COOKIE_NAME);
}

export async function requireReceiver(): Promise<SessionReceiver> {
  const receiver = await getReceiver();
  if (!receiver) throw new AppError(401, "Unauthorized", "Receiver authentication required.");
  return receiver;
}

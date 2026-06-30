import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/problem";

export type SessionUser = {
  id: string;
  username: string;
  role: "ADMIN" | "MEMBER";
  tenantId: string;
};

const SLIDING_TTL_MS = 1000 * 60 * 60 * 24;      // 24h sliding window
const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d hard cap

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",          // required for __Host- prefix; never set Domain.
    maxAge: maxAgeSec,
  };
}

export async function createSession(userId: string, ip?: string, ua?: string): Promise<void> {
  const token = randomBytes(32).toString("base64url"); // opaque 256-bit token
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SLIDING_TTL_MS);
  await prisma.session.create({ data: { userId, tokenHash, expiresAt, ip, userAgent: ua } });
  const store = await cookies();
  store.set(env.SESSION_COOKIE_NAME, token, cookieOptions(Math.floor(ABSOLUTE_TTL_MS / 1000)));
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, username: true, role: true, tenantId: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  const absoluteExpiry = session.createdAt.getTime() + ABSOLUTE_TTL_MS;

  // Expired by sliding window OR past absolute lifetime → invalidate.
  if (session.expiresAt.getTime() <= now || now >= absoluteExpiry) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Sliding renewal, never beyond the absolute cap.
  const renewed = Math.min(now + SLIDING_TTL_MS, absoluteExpiry);
  if (renewed > session.expiresAt.getTime()) {
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(renewed) } });
  }

  return session.user as SessionUser;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(env.SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(env.SESSION_COOKIE_NAME);
}

export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError(401, "Unauthorized", "Authentication required.");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== "ADMIN") throw new AppError(403, "Forbidden", "Administrator role required.");
  return user;
}

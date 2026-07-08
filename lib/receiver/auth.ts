import "server-only";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { AppError } from "@/lib/http/problem";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Receiver credential operations (P3, #85). Mirrors the tenant `User` auth
 * (argon2id via lib/auth/password) but against the global `Receiver` persona,
 * keyed by email. No tenant linkage — a receiver can be paid by any tenant.
 */

/** Register a new receiver. Email uniqueness is enforced by the DB (P2002 → 409). */
export async function registerReceiver(email: string, password: string): Promise<{ id: string }> {
  const passwordHash = await hashPassword(password);
  try {
    const r = await prisma.receiver.create({ data: { email, passwordHash } });
    return { id: r.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "Email unavailable", "That email is already registered.");
    }
    throw err;
  }
}

/**
 * Verify an email + password. Returns the receiver id on success, else null.
 * Constant-time password check; never reveals whether the email exists.
 */
export async function verifyReceiverCredentials(email: string, password: string): Promise<{ id: string } | null> {
  const r = await prisma.receiver.findUnique({ where: { email } });
  const ok = r ? await verifyPassword(r.passwordHash, password) : false;
  return r && ok ? { id: r.id } : null;
}

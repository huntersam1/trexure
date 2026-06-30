import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { loginSchema } from "@/lib/validation/auth";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { problem } from "@/lib/http/problem";
import { logger } from "@/lib/log";

// Lazily-computed dummy hash so unknown usernames still pay the verify cost (anti-enumeration timing).
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return problem(400, "Bad Request", "Request body must be valid JSON.");
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return problem(400, "Bad Request", "Invalid login payload.");
  }
  const { username, password } = parsed.data;

  // Throttle per-IP and per-username.
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(`login:ip:${ip}`, { limit: 10, windowSec: 300 }),
    rateLimit(`login:user:${username}`, { limit: 5, windowSec: 300 }),
  ]);
  if (!ipLimit.allowed || !userLimit.allowed) {
    const retryAfter = Math.max(ipLimit.retryAfterSec, userLimit.retryAfterSec);
    const res = problem(429, "Too Many Requests", "Too many login attempts. Try again later.");
    res.headers.set("Retry-After", String(retryAfter));
    return res;
  }

  const user = await prisma.user.findUnique({ where: { username } });
  // Always run a verify (real hash or dummy) to keep timing uniform — no user enumeration.
  const hash = user?.passwordHash ?? (await getDummyHash());
  const ok = await verifyPassword(hash, password);

  if (!user || !ok) {
    logger.warn({ ip }, "auth.login.failed"); // never log username/password
    return problem(401, "Unauthorized", "Invalid username or password.");
  }

  await createSession(user.id, ip, req.headers.get("user-agent") ?? undefined);
  await prisma.auditLog.create({
    data: { tenantId: user.tenantId, userId: user.id, action: "auth.login", ip },
  });
  logger.info({ userId: user.id, ip }, "auth.login.success");

  return NextResponse.json({ ok: true });
}

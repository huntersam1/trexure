import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redisConnection } from "@/lib/queue";
import { readHeartbeat } from "@/lib/worker/heartbeat";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = { db: false, redis: false, worker: false };

  try { await prisma.$queryRaw`SELECT 1`; checks.db = true; } catch { /* reported as false */ }
  try { checks.redis = (await redisConnection.ping()) === "PONG"; } catch { /* false */ }

  let lastBeatMs: number | null = null;
  try {
    const hb = await readHeartbeat();
    checks.worker = hb.alive;
    lastBeatMs = hb.lastBeatMs;
  } catch { /* false */ }

  const healthy = checks.db && checks.redis && checks.worker;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, worker: { lastBeatMs } },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

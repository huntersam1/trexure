import { NextResponse } from "next/server";
import Redis from "ioredis";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";
import { problem } from "@/lib/http/problem";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, "health: db ping failed");
    return false;
  }
}

async function pingRedis(): Promise<{ ok: boolean; worker: string }> {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
  });
  try {
    await redis.connect();
    await redis.ping();
    const heartbeat = await redis.get("worker:heartbeat");
    return { ok: true, worker: heartbeat ?? "unknown" };
  } catch (err) {
    logger.error({ err }, "health: redis ping failed");
    return { ok: false, worker: "unknown" };
  } finally {
    redis.disconnect();
  }
}

export async function GET() {
  const [dbOk, redisResult] = await Promise.all([pingDb(), pingRedis()]);

  if (!dbOk || !redisResult.ok) {
    return problem(
      503,
      "Service Unavailable",
      `db=${dbOk ? "ok" : "down"} redis=${redisResult.ok ? "ok" : "down"}`,
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      db: "ok",
      redis: "ok",
      worker: redisResult.worker,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

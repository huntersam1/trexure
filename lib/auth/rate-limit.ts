import "server-only";
import Redis from "ioredis";
import { env } from "@/lib/env";

// Single shared connection for rate-limit counters (login/webhook/api-key gates).
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });

export async function rateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    // First hit in this window — start the expiry clock.
    await redis.expire(redisKey, opts.windowSec);
  }
  if (count > opts.limit) {
    const ttl = await redis.ttl(redisKey);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : opts.windowSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

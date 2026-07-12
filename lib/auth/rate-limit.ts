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

/**
 * Enforce a rate limit for an expensive authenticated endpoint (#143). Returns a
 * 429 `problem+json` Response (with `Retry-After`) when over the limit, or null
 * to proceed. Call AFTER auth so `key` is scoped to the caller's tenant/user.
 */
export async function enforceRateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<Response | null> {
  const rl = await rateLimit(key, opts);
  if (rl.allowed) return null;
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Too Many Requests",
      status: 429,
      detail: "Rate limit exceeded for this endpoint. Retry shortly.",
    }),
    { status: 429, headers: { "content-type": "application/problem+json", "retry-after": String(rl.retryAfterSec) } },
  );
}

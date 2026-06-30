import "server-only";

import { redisConnection } from "./queue";

const PREFIX = "idem";
const DEFAULT_TTL_SEC = 24 * 60 * 60; // 24h

const composeKey = (scope: string, key: string): string => `${PREFIX}:${scope}:${key}`;

/** Returns the cached value (e.g. a paymentId) for an Idempotency-Key, or null. */
export async function getCachedIdempotent(scope: string, key: string): Promise<string | null> {
  return redisConnection.get(composeKey(scope, key));
}

/** Cache an Idempotency-Key -> value mapping with a TTL. */
export async function setCachedIdempotent(
  scope: string,
  key: string,
  value: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<void> {
  await redisConnection.set(composeKey(scope, key), value, "EX", ttlSec);
}

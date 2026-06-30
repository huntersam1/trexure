import "server-only";

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../env";

/** Frozen job-name constants (see 0000-roadmap.md cross-phase contract). */
export const QUEUE = {
  WATCH_ONCHAIN: "watch-onchain",
  RECONCILE: "reconcile",
} as const;

/**
 * Single shared ioredis connection for all BullMQ queues.
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking commands.
 */
export const redisConnection: Redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

export const watchOnchainQueue: Queue<{ paymentId: string }> = new Queue<{ paymentId: string }>(
  QUEUE.WATCH_ONCHAIN,
  { connection: redisConnection, defaultJobOptions },
);

export const reconcileQueue: Queue<{ paymentId: string }> = new Queue<{ paymentId: string }>(
  QUEUE.RECONCILE,
  { connection: redisConnection, defaultJobOptions },
);

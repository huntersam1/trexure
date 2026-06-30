import "dotenv/config";
import { Worker } from "bullmq";
import { redisConnection, QUEUE } from "../lib/queue";
import { logger } from "../lib/log";
import {
  processWatchOnchain,
  watchOnchainBackoff,
  MAX_WATCH_ATTEMPTS,
} from "./jobs/watch-onchain";
import { processReconcile } from "./jobs/reconcile";
import { writeHeartbeat, HEARTBEAT_INTERVAL_MS } from "../lib/worker/heartbeat";

async function main(): Promise<void> {
  await writeHeartbeat();
  const heartbeat = setInterval(() => {
    void writeHeartbeat().catch((err) => logger.error({ err }, "heartbeat write failed"));
  }, HEARTBEAT_INTERVAL_MS);

  const watchWorker = new Worker(QUEUE.WATCH_ONCHAIN, processWatchOnchain, {
    connection: redisConnection,
    settings: { backoffStrategy: watchOnchainBackoff },
  });
  const reconcileWorker = new Worker(QUEUE.RECONCILE, processReconcile, {
    connection: redisConnection,
  });

  for (const w of [watchWorker, reconcileWorker]) {
    w.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "job failed"));
  }
  logger.info({ maxWatchAttempts: MAX_WATCH_ATTEMPTS }, "worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "worker shutting down");
    clearInterval(heartbeat);
    await Promise.allSettled([watchWorker.close(), reconcileWorker.close()]);
    await redisConnection.quit();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});

import "server-only";
import type { Job } from "bullmq";
import { tryReconcile } from "../../lib/reconcile/matcher";
import { logger } from "../../lib/log";

export async function processReconcile(job: Job<{ paymentId: string }>): Promise<void> {
  const { paymentId } = job.data;
  const result = await tryReconcile(paymentId);
  logger.info({ paymentId, result }, "reconcile job complete");
}

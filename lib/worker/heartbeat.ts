import "server-only";
import { redisConnection } from "../queue";

export const HEARTBEAT_KEY = "trexure:worker:heartbeat";
export const HEARTBEAT_TTL_SEC = 30;
export const HEARTBEAT_INTERVAL_MS = 10_000;

export async function writeHeartbeat(): Promise<void> {
  await redisConnection.set(HEARTBEAT_KEY, Date.now().toString(), "EX", HEARTBEAT_TTL_SEC);
}

export async function readHeartbeat(): Promise<{ alive: boolean; lastBeatMs: number | null }> {
  const raw = await redisConnection.get(HEARTBEAT_KEY);
  if (!raw) return { alive: false, lastBeatMs: null };
  const lastBeatMs = Number(raw);
  if (!Number.isFinite(lastBeatMs)) return { alive: false, lastBeatMs: null };
  return { alive: Date.now() - lastBeatMs < HEARTBEAT_TTL_SEC * 1000, lastBeatMs };
}

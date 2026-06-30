import { describe, it, expect, vi } from "vitest";

// Mock ioredis + bullmq so the test never opens a real connection.
vi.mock("ioredis", () => {
  const Redis = vi.fn().mockImplementation((url: string) => ({ __url: url, options: {} }));
  return { default: Redis, Redis };
});
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string, opts: unknown) => ({ name, opts })),
}));
vi.mock("../../../lib/env", () => ({ env: { REDIS_URL: "redis://localhost:6379" } }));

describe("lib/queue", () => {
  it("exposes the frozen QUEUE name constants", async () => {
    const { QUEUE } = await import("../../../lib/queue");
    expect(QUEUE.WATCH_ONCHAIN).toBe("watch-onchain");
    expect(QUEUE.RECONCILE).toBe("reconcile");
  });

  it("creates one Queue per job type bound to the redis connection", async () => {
    const { watchOnchainQueue, reconcileQueue, redisConnection } = await import("../../../lib/queue");
    expect(watchOnchainQueue.name).toBe("watch-onchain");
    expect(reconcileQueue.name).toBe("reconcile");
    expect(redisConnection).toBeDefined();
  });
});

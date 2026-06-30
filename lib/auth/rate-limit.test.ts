import { describe, it, expect, vi, beforeEach } from "vitest";

// Hermetic in-memory ioredis fake (fixed-window: INCR + EXPIRE + TTL).
vi.mock("ioredis", () => {
  class FakeRedis {
    private store = new Map<string, { count: number; expireAt: number }>();
    constructor(_url?: string, _opts?: unknown) {}
    async incr(key: string): Promise<number> {
      const now = Date.now();
      const e = this.store.get(key);
      if (!e || e.expireAt <= now) {
        this.store.set(key, { count: 1, expireAt: Number.POSITIVE_INFINITY });
        return 1;
      }
      e.count += 1;
      return e.count;
    }
    async expire(key: string, seconds: number): Promise<number> {
      const e = this.store.get(key);
      if (!e) return 0;
      e.expireAt = Date.now() + seconds * 1000;
      return 1;
    }
    async ttl(key: string): Promise<number> {
      const e = this.store.get(key);
      if (!e || e.expireAt === Number.POSITIVE_INFINITY) return -1;
      return Math.ceil((e.expireAt - Date.now()) / 1000);
    }
  }
  return { default: FakeRedis };
});

vi.mock("@/lib/env", () => ({ env: { REDIS_URL: "redis://localhost:6379" } }));

import { rateLimit } from "@/lib/auth/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("allows requests up to the limit then blocks", async () => {
    const key = `t:${Math.random()}`;
    const opts = { limit: 3, windowSec: 60 };
    expect((await rateLimit(key, opts)).allowed).toBe(true);
    expect((await rateLimit(key, opts)).allowed).toBe(true);
    expect((await rateLimit(key, opts)).allowed).toBe(true);
    const blocked = await rateLimit(key, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("scopes counters by key", async () => {
    const opts = { limit: 1, windowSec: 60 };
    expect((await rateLimit("k:a", opts)).allowed).toBe(true);
    expect((await rateLimit("k:b", opts)).allowed).toBe(true);
  });
});

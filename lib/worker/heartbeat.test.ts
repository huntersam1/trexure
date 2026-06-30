import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  const redisConnection = {
    set: vi.fn(async (key: string, val: string) => { store.set(key, val); return "OK"; }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    ping: vi.fn(async () => "PONG"),
  };
  return { store, redisConnection };
});

vi.mock("../queue", () => ({ redisConnection: h.redisConnection }));

import { writeHeartbeat, readHeartbeat, HEARTBEAT_KEY, HEARTBEAT_TTL_SEC } from "./heartbeat";

describe("worker heartbeat", () => {
  beforeEach(() => { h.store.clear(); h.redisConnection.set.mockClear(); });

  it("writes the heartbeat key with an EX ttl", async () => {
    await writeHeartbeat();
    expect(h.redisConnection.set).toHaveBeenCalledWith(
      HEARTBEAT_KEY, expect.any(String), "EX", HEARTBEAT_TTL_SEC,
    );
  });

  it("reads alive when the beat is recent", async () => {
    await writeHeartbeat();
    const hb = await readHeartbeat();
    expect(hb.alive).toBe(true);
    expect(typeof hb.lastBeatMs).toBe("number");
  });

  it("reads not-alive when the key is missing", async () => {
    const hb = await readHeartbeat();
    expect(hb).toEqual({ alive: false, lastBeatMs: null });
  });

  it("reads not-alive when the beat is stale", async () => {
    const stale = Date.now() - (HEARTBEAT_TTL_SEC + 5) * 1000;
    h.store.set(HEARTBEAT_KEY, String(stale));
    const hb = await readHeartbeat();
    expect(hb.alive).toBe(false);
    expect(hb.lastBeatMs).toBe(stale);
  });
});

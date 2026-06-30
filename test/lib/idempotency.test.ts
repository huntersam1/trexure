import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
const get = vi.fn(async (k: string) => store.get(k) ?? null);
const set = vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; });

vi.mock("../../lib/queue", () => ({ redisConnection: { get, set } }));

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe("idempotency cache", () => {
  it("returns null when key absent then the value after set", async () => {
    const { getCachedIdempotent, setCachedIdempotent } = await import("../../lib/idempotency");
    expect(await getCachedIdempotent("payments:t1", "k1")).toBeNull();
    await setCachedIdempotent("payments:t1", "k1", "pay_abc");
    expect(await getCachedIdempotent("payments:t1", "k1")).toBe("pay_abc");
  });

  it("namespaces by scope so tenants never collide", async () => {
    const { getCachedIdempotent, setCachedIdempotent } = await import("../../lib/idempotency");
    await setCachedIdempotent("payments:t1", "same", "pay_t1");
    expect(await getCachedIdempotent("payments:t2", "same")).toBeNull();
  });

  it("sets a TTL via EX", async () => {
    const { setCachedIdempotent } = await import("../../lib/idempotency");
    await setCachedIdempotent("payments:t1", "k", "v", 60);
    expect(set).toHaveBeenCalledWith("idem:payments:t1:k", "v", "EX", 60);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
const get = vi.fn(async (k: string) => store.get(k) ?? null);
// Mimic ioredis: `SET k v EX ttl NX` returns null if the key already exists.
const set = vi.fn(async (k: string, v: string, ...args: unknown[]) => {
  if (args.includes("NX") && store.has(k)) return null;
  store.set(k, v);
  return "OK";
});
const del = vi.fn(async (k: string) => { store.delete(k); return 1; });

vi.mock("../../lib/queue", () => ({ redisConnection: { get, set, del } }));

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

  it("reserveIdempotent: exactly one concurrent caller wins the SET NX (#143)", async () => {
    const { reserveIdempotent, IDEM_PENDING } = await import("../../lib/idempotency");
    const first = await reserveIdempotent("payments:t1", "race");
    expect(first).toEqual({ reserved: true, existing: null });
    // A second reservation loses and sees the pending sentinel.
    const second = await reserveIdempotent("payments:t1", "race");
    expect(second.reserved).toBe(false);
    expect(second.existing).toBe(IDEM_PENDING);
  });

  it("reserveIdempotent: after finalize, the loser gets the real value", async () => {
    const { reserveIdempotent, setCachedIdempotent } = await import("../../lib/idempotency");
    await reserveIdempotent("payments:t1", "k");
    await setCachedIdempotent("payments:t1", "k", "pay_final"); // winner finalizes (overwrites)
    const again = await reserveIdempotent("payments:t1", "k");
    expect(again).toEqual({ reserved: false, existing: "pay_final" });
  });

  it("releaseIdempotent clears the reservation so a retry can proceed", async () => {
    const { reserveIdempotent, releaseIdempotent } = await import("../../lib/idempotency");
    await reserveIdempotent("payments:t1", "k");
    await releaseIdempotent("payments:t1", "k");
    expect(del).toHaveBeenCalledWith("idem:payments:t1:k");
    const retry = await reserveIdempotent("payments:t1", "k");
    expect(retry.reserved).toBe(true);
  });
});

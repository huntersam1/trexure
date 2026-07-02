import { describe, it, expect, afterEach, vi } from "vitest";

// lib/env parses process.env at import time, so exercise the schema default by
// clearing the var and re-importing the module in isolation.
describe("env ENABLE_NEW_PAYMENTS default", () => {
  const original = process.env.ENABLE_NEW_PAYMENTS;

  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_NEW_PAYMENTS;
    else process.env.ENABLE_NEW_PAYMENTS = original;
    vi.resetModules();
  });

  it("defaults to true so the SPEC's primary flow ships enabled (#40)", async () => {
    delete process.env.ENABLE_NEW_PAYMENTS;
    vi.resetModules();
    const { env } = await import("../../lib/env");
    expect(env.ENABLE_NEW_PAYMENTS).toBe(true);
  });

  it("still honors an explicit false (kept as a deploy-time kill switch)", async () => {
    process.env.ENABLE_NEW_PAYMENTS = "false";
    vi.resetModules();
    const { env } = await import("../../lib/env");
    expect(env.ENABLE_NEW_PAYMENTS).toBe(false);
  });
});

describe("env ZK_PROVING", () => {
  const original = process.env.ZK_PROVING;

  afterEach(() => {
    if (original === undefined) delete process.env.ZK_PROVING;
    else process.env.ZK_PROVING = original;
    vi.resetModules();
  });

  it("defaults to 'live' so user-created payments carry a real commitment (#46)", async () => {
    delete process.env.ZK_PROVING;
    vi.resetModules();
    const { env } = await import("../../lib/env");
    expect(env.ZK_PROVING).toBe("live");
  });

  it("honors an explicit 'fallback' (offline/CI escape hatch)", async () => {
    process.env.ZK_PROVING = "fallback";
    vi.resetModules();
    const { env } = await import("../../lib/env");
    expect(env.ZK_PROVING).toBe("fallback");
  });

  it("rejects an unknown value (validated enum, not raw process.env)", async () => {
    process.env.ZK_PROVING = "sorta";
    vi.resetModules();
    await expect(import("../../lib/env")).rejects.toThrow(/ZK_PROVING/);
  });
});

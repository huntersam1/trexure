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

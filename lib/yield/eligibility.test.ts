import { describe, it, expect } from "vitest";

import { computeSweepAmount } from "./eligibility";
import type { YieldConfigView } from "./config";

function cfg(patch: Partial<YieldConfigView> = {}): YieldConfigView {
  return {
    enabled: true,
    yieldAsset: "YLDS",
    minIdleBuffer: "0",
    sweepThreshold: "0",
    feeBps: "0",
    ...patch,
  };
}

describe("computeSweepAmount", () => {
  it("sweeps the full amount when enabled with no buffer/threshold", () => {
    expect(computeSweepAmount("1000", cfg())).toEqual({ eligible: "1000", reason: "ok" });
  });

  it("is disabled → no sweep", () => {
    expect(computeSweepAmount("1000", cfg({ enabled: false }))).toEqual({
      eligible: "0",
      reason: "disabled",
    });
  });

  it("keeps the buffer liquid: sweeps only the amount above minIdleBuffer", () => {
    expect(computeSweepAmount("1000", cfg({ minIdleBuffer: "300" }))).toEqual({
      eligible: "700",
      reason: "ok",
    });
  });

  it("within buffer (amount <= buffer) → no sweep", () => {
    expect(computeSweepAmount("300", cfg({ minIdleBuffer: "300" }))).toEqual({
      eligible: "0",
      reason: "within-buffer",
    });
  });

  it("below threshold → no sweep (swap cost dominates)", () => {
    expect(computeSweepAmount("1000", cfg({ minIdleBuffer: "800", sweepThreshold: "500" }))).toEqual(
      { eligible: "0", reason: "below-threshold" },
    );
  });

  it("exactly at threshold → sweeps", () => {
    expect(
      computeSweepAmount("1000", cfg({ minIdleBuffer: "500", sweepThreshold: "500" })),
    ).toEqual({ eligible: "500", reason: "ok" });
  });

  it("uses Decimal math (fractional buffer)", () => {
    expect(computeSweepAmount("100.25", cfg({ minIdleBuffer: "0.05" }))).toEqual({
      eligible: "100.2",
      reason: "ok",
    });
  });
});

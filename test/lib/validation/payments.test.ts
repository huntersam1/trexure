import { describe, it, expect } from "vitest";
import { createPaymentSchema, listPaymentsQuerySchema, corridorFor } from "../../../lib/validation/payments";

describe("createPaymentSchema", () => {
  const valid = {
    recipientRef: "rcp_123",
    amount: "2500.00",
    sourceAsset: "USDC",
    targetCurrency: "PHP",
    anchorId: "anchor_1",
  };

  it("accepts a valid payload (memo optional)", () => {
    const parsed = createPaymentSchema.parse(valid);
    expect(parsed.amount).toBe("2500.00");
    expect(parsed.memo).toBeUndefined();
  });

  it("rejects unknown keys (.strict)", () => {
    expect(() => createPaymentSchema.parse({ ...valid, evil: 1 })).toThrow();
  });

  it("rejects a non-decimal amount", () => {
    expect(() => createPaymentSchema.parse({ ...valid, amount: "not-a-number" })).toThrow();
  });

  it("rejects a zero or negative amount", () => {
    expect(() => createPaymentSchema.parse({ ...valid, amount: "0" })).toThrow();
    expect(() => createPaymentSchema.parse({ ...valid, amount: "-5.00" })).toThrow();
  });

  it("rejects a missing required field", () => {
    const { sourceAsset, ...rest } = valid;
    void sourceAsset;
    expect(() => createPaymentSchema.parse(rest)).toThrow();
  });
});

describe("listPaymentsQuerySchema", () => {
  it("defaults limit to 20 and clamps to 100", () => {
    expect(listPaymentsQuerySchema.parse({}).limit).toBe(20);
    expect(listPaymentsQuerySchema.parse({ limit: "500" }).limit).toBe(100);
  });
  it("rejects an unknown status", () => {
    expect(() => listPaymentsQuerySchema.parse({ status: "BOGUS" })).toThrow();
  });
});

describe("corridorFor", () => {
  it("maps USDC->PHP to USD->PHP", () => {
    expect(corridorFor("USDC", "PHP")).toEqual({ from: "USD", to: "PHP" });
  });
  it("passes through non-USD assets by stripping a trailing C heuristic only for known stablecoins", () => {
    expect(corridorFor("XLM", "PHP")).toEqual({ from: "XLM", to: "PHP" });
  });
});

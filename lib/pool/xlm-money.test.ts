import { describe, it, expect } from "vitest";
import { xlmToStroops } from "@/lib/pool/service";
import { poolDepositSchema } from "@/lib/validation/pool";

describe("xlmToStroops (#143 H2 — no float)", () => {
  it("converts exact XLM to whole stroops", () => {
    expect(xlmToStroops("1")).toBe(10_000_000n);
    expect(xlmToStroops("0.0000001")).toBe(1n); // 1 stroop
    expect(xlmToStroops("2500.00")).toBe(25_000_000_000n);
  });

  it("stays exact above the 2^53 float boundary where Math.round(amount*1e7) loses precision", () => {
    // 9007199254740993 stroops = the first odd integer above 2^53 → not float-representable.
    const amount = "900719925.4740993";
    const exact = 9_007_199_254_740_993n;
    expect(xlmToStroops(amount)).toBe(exact);
    // The OLD float path silently rounds to the even neighbour — this is the bug.
    expect(BigInt(Math.round(Number(amount) * 1e7))).not.toBe(exact);
  });

  it("throws rather than rounding money away for sub-stroop (>7 dp) precision", () => {
    expect(() => xlmToStroops("1.00000001")).toThrow(/precision/);
  });

  it("throws on non-positive / non-finite amounts", () => {
    expect(() => xlmToStroops("0")).toThrow();
    expect(() => xlmToStroops("-5")).toThrow();
    expect(() => xlmToStroops("nope")).toThrow();
  });
});

describe("poolDepositSchema amount (#143 H2 — Decimal string)", () => {
  it("normalizes a JSON number to a decimal string", () => {
    expect(poolDepositSchema.parse({ amount: 40 })).toEqual({ amount: "40" });
    expect(poolDepositSchema.parse({ amount: 40.5 })).toEqual({ amount: "40.5" });
  });

  it("accepts a decimal string as-is", () => {
    expect(poolDepositSchema.parse({ amount: "12.3456789" })).toEqual({ amount: "12.3456789" });
  });

  it("rejects non-positive, over-cap, and > 7 dp amounts", () => {
    expect(poolDepositSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(poolDepositSchema.safeParse({ amount: 10_001 }).success).toBe(false);
    expect(poolDepositSchema.safeParse({ amount: "1.123456789" }).success).toBe(false);
  });
});

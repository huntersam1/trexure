import { describe, it, expect } from "vitest";
import { sanitizeNext } from "@/lib/receiver/safe-next";

describe("sanitizeNext (#81)", () => {
  it("allows internal receiver-area paths (incl. the emailed access link)", () => {
    expect(sanitizeNext("/claim")).toBe("/claim");
    expect(sanitizeNext("/claim/inbox")).toBe("/claim/inbox");
    expect(sanitizeNext("/claim/access?t=abc.def")).toBe("/claim/access?t=abc.def");
  });

  it("falls back to /claim for anything outside the receiver area or unsafe", () => {
    expect(sanitizeNext(undefined)).toBe("/claim");
    expect(sanitizeNext(null)).toBe("/claim");
    expect(sanitizeNext("")).toBe("/claim");
    expect(sanitizeNext("/settings")).toBe("/claim"); // tenant area
    expect(sanitizeNext("//evil.com")).toBe("/claim"); // protocol-relative open redirect
    expect(sanitizeNext("https://evil.com")).toBe("/claim");
    expect(sanitizeNext("/claimant-scam")).toBe("/claim"); // prefix-only lookalike
  });
});

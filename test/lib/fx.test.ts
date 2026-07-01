import { describe, it, expect } from "vitest";
import { quoteTargetAmount, DEMO_FX_RATES } from "@/lib/fx";

describe("quoteTargetAmount", () => {
  it("quotes the demo USD->PHP corridor at the shared rate", () => {
    expect(DEMO_FX_RATES["USD:PHP"]).toBe("56.70");
    expect(quoteTargetAmount("2500.00", "USD", "PHP")).toBe("141750.00");
  });

  it("accepts Decimal-like inputs (Prisma rows)", () => {
    expect(quoteTargetAmount({ toString: () => "2500.00000000" }, "USD", "PHP")).toBe("141750.00");
  });

  it("returns null for an unquoted corridor", () => {
    expect(quoteTargetAmount("100.00", "USD", "EUR")).toBeNull();
  });
});

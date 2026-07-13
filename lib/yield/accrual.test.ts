import { describe, it, expect } from "vitest";

import { accrueYield, YIELD_APY_BPS } from "./accrual";

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

describe("accrueYield", () => {
  it("accrues a full year at the demo APY (5% of principal)", () => {
    expect(accrueYield("1000", MS_PER_YEAR)).toBe("50.00000000");
    expect(YIELD_APY_BPS.toString()).toBe("500");
  });

  it("scales linearly with the hold duration", () => {
    expect(accrueYield("1000", MS_PER_YEAR / 2)).toBe("25.00000000");
    expect(accrueYield("2000", MS_PER_YEAR / 2)).toBe("50.00000000");
  });

  it("is zero for a non-positive hold (clock skew / same instant)", () => {
    expect(accrueYield("1000", 0)).toBe("0.00000000");
    expect(accrueYield("1000", -5000)).toBe("0.00000000");
  });
});

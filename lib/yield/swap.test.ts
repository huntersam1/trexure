import { describe, it, expect } from "vitest";

import { simulateSwap, SWAP_SLIPPAGE_BPS } from "./swap";

describe("simulateSwap", () => {
  it("applies the slippage: toAmount = from * (1 - bps/10000)", () => {
    const s = simulateSwap("in:pay_1", "1000");
    // 5 bps of 1000 = 0.5
    expect(s.slippage).toBe("0.50000000");
    expect(s.toAmount).toBe("999.50000000");
    expect(s.fromAmount).toBe("1000.00000000");
    expect(SWAP_SLIPPAGE_BPS.toString()).toBe("5");
  });

  it("reports the effective fill rate", () => {
    const s = simulateSwap("in:pay_1", "1000");
    expect(s.rate).toBe("0.99950000");
  });

  it("is deterministic in the seed (stable tx hash + ledger)", () => {
    const a = simulateSwap("in:pay_1", "1000");
    const b = simulateSwap("in:pay_1", "1000");
    expect(a.txHash).toBe(b.txHash);
    expect(a.ledger).toBe(b.ledger);
    expect(a.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ledger).toBeGreaterThan(0);
  });

  it("distinguishes hops by seed (in vs out differ)", () => {
    const inHop = simulateSwap("in:pay_1", "1000");
    const outHop = simulateSwap("out:pay_1", "999.5");
    expect(inHop.txHash).not.toBe(outHop.txHash);
  });

  it("handles a zero amount without dividing by zero", () => {
    const s = simulateSwap("in:pay_0", "0");
    expect(s.toAmount).toBe("0.00000000");
    expect(s.rate).toBe("0");
  });
});

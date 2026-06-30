import { describe, expect, it } from "vitest";
import { fillPercent, nodeState, STEPPER_NODES } from "@/lib/ui/stepper";

describe("stepper state math", () => {
  it("has 4 nodes Ledger->Enclave->Recon->Receipt", () => {
    expect(STEPPER_NODES.map((n) => n.label)).toEqual(["Ledger", "Enclave", "Recon", "Receipt"]);
  });

  it("classifies nodes relative to current", () => {
    expect(nodeState(0, 2)).toBe("complete");
    expect(nodeState(1, 2)).toBe("complete");
    expect(nodeState(2, 2)).toBe("active");
    expect(nodeState(3, 2)).toBe("future");
  });

  it("fills 0 / 33.3 / 66.6 / 100 across 4 nodes", () => {
    expect(fillPercent(0, 4)).toBeCloseTo(0, 1);
    expect(fillPercent(1, 4)).toBeCloseTo(33.3, 1);
    expect(fillPercent(2, 4)).toBeCloseTo(66.666, 1);
    expect(fillPercent(3, 4)).toBeCloseTo(100, 1);
  });

  it("clamps out-of-range current values", () => {
    expect(fillPercent(-2, 4)).toBe(0);
    expect(fillPercent(9, 4)).toBe(100);
  });
});

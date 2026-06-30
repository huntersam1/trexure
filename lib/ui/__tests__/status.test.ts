import { describe, expect, it } from "vitest";
import { statusToBadge } from "@/lib/ui/status";

describe("statusToBadge", () => {
  it("maps PENDING/DRAFT to neutral surface-container-highest", () => {
    const b = statusToBadge("PENDING");
    expect(b.state).toBe("PENDING");
    expect(b.classes).toContain("bg-surface-container-highest");
    expect(b.classes).toContain("text-on-surface-variant");
    expect(b.spinner).toBe(false);
    expect(statusToBadge("DRAFT").classes).toContain("bg-surface-container-highest");
  });

  it("maps ONCHAIN_CONFIRMED/VERIFIED to primary/20 + primary", () => {
    const b = statusToBadge("ONCHAIN_CONFIRMED");
    expect(b.state).toBe("VERIFIED");
    expect(b.label).toBe("VERIFIED");
    expect(b.classes).toContain("bg-primary/20");
    expect(b.classes).toContain("text-primary");
  });

  it("maps RECONCILING to primary/10 with a spinner", () => {
    const b = statusToBadge("RECONCILING");
    expect(b.classes).toContain("bg-primary/10");
    expect(b.classes).toContain("text-primary");
    expect(b.spinner).toBe(true);
  });

  it("maps SETTLED to accent/20 + accent (gold settles)", () => {
    const b = statusToBadge("SETTLED");
    expect(b.classes).toContain("bg-accent/20");
    expect(b.classes).toContain("text-accent");
    expect(b.icon).toBe("check");
  });

  it("maps FAILED to error-container + error", () => {
    const b = statusToBadge("FAILED");
    expect(b.classes).toContain("bg-error-container");
    expect(b.classes).toContain("text-error");
  });
});

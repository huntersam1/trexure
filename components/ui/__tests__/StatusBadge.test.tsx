// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/ui/StatusBadge";

describe("StatusBadge", () => {
  it("renders the SETTLED gold token and label", () => {
    render(<StatusBadge status="SETTLED" />);
    const el = screen.getByText("SETTLED");
    const badge = el.closest("span[data-state]")!;
    expect(badge.getAttribute("data-state")).toBe("SETTLED");
    expect(badge.className).toContain("bg-accent/20");
    expect(badge.className).toContain("text-accent");
  });

  it("maps ONCHAIN_CONFIRMED to the VERIFIED purple token", () => {
    render(<StatusBadge status="ONCHAIN_CONFIRMED" />);
    const badge = screen.getByText("VERIFIED").closest("span[data-state]")!;
    expect(badge.getAttribute("data-state")).toBe("VERIFIED");
    expect(badge.className).toContain("bg-primary/20");
  });

  it("adds a spinning icon for RECONCILING", () => {
    const { container } = render(<StatusBadge status="RECONCILING" />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Stepper } from "@/components/ui/Stepper";

// vitest globals:false disables Testing Library's automatic cleanup, so renders
// would otherwise accumulate in document.body across tests.
afterEach(cleanup);

describe("Stepper", () => {
  it("renders the active node and fill width for current=2", () => {
    const { container } = render(<Stepper current={2} />);
    const active = container.querySelector('[aria-current="step"]')!;
    expect(active.className).toContain("border-primary");
    const fill = container.querySelector(".trx-stepper-fill") as HTMLElement;
    expect(fill.style.width).toBe("66.66666666666666%");
  });

  it("shows a check on completed nodes", () => {
    render(<Stepper current={3} />);
    // Ledger, Enclave, Recon complete => 3 check glyphs
    expect(screen.getAllByText("check")).toHaveLength(3);
  });
});

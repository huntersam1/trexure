// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AppShell } from "../AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

function renderShell() {
  return render(
    <AppShell
      username="admin"
      role="ADMIN"
      newPaymentsEnabled
      poolRailEnabled={false}
      onLogout={vi.fn()}
    >
      <p>page body</p>
    </AppShell>,
  );
}

describe("AppShell (#115)", () => {
  it("renders the content and a mobile menu button", () => {
    renderShell();
    expect(screen.getByText("page body")).not.toBeNull();
    expect(screen.getByLabelText("Open menu")).not.toBeNull();
  });

  it("starts with the drawer hidden and opens it on the menu button", () => {
    renderShell();
    const drawer = () => screen.getByTestId("mobile-drawer");
    expect(drawer().getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(screen.getByLabelText("Open menu"));
    expect(drawer().getAttribute("aria-hidden")).toBe("false");
  });

  it("closes the drawer via the backdrop", () => {
    renderShell();
    fireEvent.click(screen.getByLabelText("Open menu"));
    const drawer = screen.getByTestId("mobile-drawer");
    expect(drawer.getAttribute("aria-hidden")).toBe("false");

    // The backdrop shares the "Close menu" label with the drawer's X button;
    // the first match is the backdrop overlay.
    fireEvent.click(screen.getAllByLabelText("Close menu")[0]!);
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
  });
});

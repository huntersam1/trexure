// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

describe("Sidebar", () => {
  it("shows no badge on New Payment when new payments are enabled", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled />);
    expect(screen.queryByText("soon")).toBeNull();
  });

  it("badges New Payment with the in-progress tooltip when gated off (#32)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled={false} />);
    const badge = screen.getByText("soon");
    expect(badge.getAttribute("title")).toBe("Shielded transfer contract — in progress");
    // The nav item still links to the explanatory page rather than disappearing.
    expect(screen.getByText("New Payment").closest("a")?.getAttribute("href")).toBe("/payments/new");
  });

  it("hides the Private Transfer link when the pool rail is disabled (default) (#65)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled />);
    expect(screen.queryByText("Private Transfer")).toBeNull();
  });

  it("shows the Private Transfer link to /pool when the pool rail is enabled (#65)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled poolRailEnabled />);
    expect(screen.getByText("Private Transfer").closest("a")?.getAttribute("href")).toBe("/pool");
  });

  it("shows the ADMIN-only Reports link to /reports (#100)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled />);
    expect(screen.getByText("Reports").closest("a")?.getAttribute("href")).toBe("/reports");
  });

  it("hides the Reports link from non-admin members (#100)", () => {
    render(<Sidebar username="member" role="MEMBER" newPaymentsEnabled />);
    expect(screen.queryByText("Reports")).toBeNull();
  });

  it("shows the ADMIN-only Treasury Yield link to /yield when yield is enabled (#166)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled yieldEnabled />);
    expect(screen.getByText("Treasury Yield").closest("a")?.getAttribute("href")).toBe("/yield");
  });

  it("hides Treasury Yield when the flag is off (default) (#166)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled />);
    expect(screen.queryByText("Treasury Yield")).toBeNull();
  });

  it("hides Treasury Yield from non-admin members even when enabled (#166)", () => {
    render(<Sidebar username="member" role="MEMBER" newPaymentsEnabled yieldEnabled />);
    expect(screen.queryByText("Treasury Yield")).toBeNull();
  });

  it("renders a logout control wired to the given action when provided (#115)", () => {
    const onLogout = vi.fn();
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled onLogout={onLogout} />);
    const button = screen.getByLabelText("Log out");
    // Progressive-enhancement: it's a real submit inside a form bound to the action.
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.closest("form")).not.toBeNull();
  });

  it("omits the logout control when no action is supplied (#115)", () => {
    render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled />);
    expect(screen.queryByLabelText("Log out")).toBeNull();
  });

  it("renders a drawer close button only when onClose is supplied (#115)", () => {
    const { rerender } = render(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled />);
    expect(screen.queryByLabelText("Close menu")).toBeNull();
    rerender(<Sidebar username="admin" role="ADMIN" newPaymentsEnabled onClose={() => {}} />);
    expect(screen.getByLabelText("Close menu")).not.toBeNull();
  });
});

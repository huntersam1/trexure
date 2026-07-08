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
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import AppError from "./error";

afterEach(cleanup);

describe("(app) error boundary", () => {
  it("renders a branded message and retries via reset()", () => {
    const reset = vi.fn();
    render(<AppError error={Object.assign(new Error("boom"), { digest: "d123" })} reset={reset} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/d123/)).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(reset).toHaveBeenCalled();
  });
});

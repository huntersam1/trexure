// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Logo } from "../Logo";

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

describe("Logo (#115)", () => {
  it("renders the brand mark image and wordmark by default", () => {
    render(<Logo />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/logo.jpg");
    // Decorative when the wordmark carries the name.
    expect(img?.getAttribute("alt")).toBe("");
    expect(screen.getByText("Trexure")).not.toBeNull();
  });

  it("drops the wordmark and labels the mark for a11y when wordmark=false", () => {
    render(<Logo wordmark={false} />);
    expect(screen.queryByText("Trexure")).toBeNull();
    expect(screen.getByAltText("Trexure")).not.toBeNull();
  });
});

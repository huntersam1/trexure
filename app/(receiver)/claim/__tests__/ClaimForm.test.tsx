// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ClaimForm } from "../ClaimForm";

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

describe("ClaimForm prefill (#81)", () => {
  it("pre-fills the note textarea from initialNote (emailed-link flow)", () => {
    render(<ClaimForm csrfToken="x" initialNote="trexure-note-v1-abc" />);
    const ta = screen.getByPlaceholderText("trexure-note-v1-…") as HTMLTextAreaElement;
    expect(ta.value).toBe("trexure-note-v1-abc");
  });

  it("defaults to an empty note when none is provided (manual claim)", () => {
    render(<ClaimForm csrfToken="x" />);
    const ta = screen.getByPlaceholderText("trexure-note-v1-…") as HTMLTextAreaElement;
    expect(ta.value).toBe("");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RevokeKeyButton } from "./revoke-key-button";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(cleanup);
beforeEach(() => {
  refreshMock.mockReset();
  vi.unstubAllGlobals();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});

describe("RevokeKeyButton", () => {
  it("refreshes on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    render(<RevokeKeyButton id="k1" csrfToken="tok" />);
    fireEvent.click(screen.getByText("Revoke"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error on a non-ok response instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<RevokeKeyButton id="k1" csrfToken="tok" />);
    fireEvent.click(screen.getByText("Revoke"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Revoke failed");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows an error when the request throws (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    render(<RevokeKeyButton id="k1" csrfToken="tok" />);
    fireEvent.click(screen.getByText("Revoke"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Revoke failed");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { RetryReconcileButton } from "@/components/payments/RetryReconcileButton";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(cleanup);
beforeEach(() => {
  refreshMock.mockReset();
  vi.unstubAllGlobals();
});

describe("RetryReconcileButton", () => {
  it("refreshes on success and shows no error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    render(<RetryReconcileButton paymentId="p1" csrfToken="tok" />);
    fireEvent.click(screen.getByText("Retry Reconcile"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error and does not refresh on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    render(<RetryReconcileButton paymentId="p1" />);
    fireEvent.click(screen.getByText("Retry Reconcile"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Retry failed");
    expect(refreshMock).not.toHaveBeenCalled();
    // recoverable: button is enabled again for another attempt
    expect(screen.getByText("Retry Reconcile")).not.toHaveProperty("disabled", true);
  });

  it("shows an error when the request throws (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    render(<RetryReconcileButton paymentId="p1" />);
    fireEvent.click(screen.getByText("Retry Reconcile"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Retry failed");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

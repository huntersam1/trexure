// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DemoReplayController } from "@/components/demo/DemoReplayController";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(cleanup);
beforeEach(() => {
  refreshMock.mockReset();
  vi.unstubAllGlobals();
});

describe("DemoReplayController", () => {
  it("shows a visible error message when the replay fails", async () => {
    // First beat (demo-reset POST) fails — the whole replay aborts.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(
      <DemoReplayController
        paymentId="p1"
        intentId="i1"
        amount="10"
        currency="PHP"
        recipientRef="r1"
      />,
    );
    fireEvent.click(screen.getByText("Demo Replay"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Replay failed");
    // button recovers so the demo can be retried
    expect(screen.getByText("Demo Replay")).toBeTruthy();
  });
});

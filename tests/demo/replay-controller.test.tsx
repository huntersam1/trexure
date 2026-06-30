// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DemoReplayController } from "../../components/demo/DemoReplayController";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function jsonRes(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function mockFetchSequence() {
  const calls: string[] = [];
  let pollCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
      if (url.includes("/demo-reset")) return jsonRes({ status: "PENDING" });
      if (url.includes("/decrypt")) return jsonRes({ payload: { amount: "2500.00" } });
      if (url.includes("/mock-anchor/payout")) return jsonRes({ providerRef: "mock_x", bankRef: "PH-1", status: "completed" });
      if (url.match(/\/api\/payments\/[^/]+$/)) {
        pollCount += 1;
        return jsonRes({ id: "pay_1", status: pollCount >= 2 ? "SETTLED" : "RECONCILING", receipt: pollCount >= 2 ? { id: "rcpt_1" } : null });
      }
      return jsonRes({});
    }),
  );
  return { calls };
}

describe("DemoReplayController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs beats in order: reset → decrypt → payout → poll → receipt", async () => {
    const { calls } = mockFetchSequence();
    render(<DemoReplayController paymentId="pay_1" intentId="intent_x" amount="2500.00" currency="PHP" recipientRef="c1" />);
    fireEvent.click(screen.getByRole("button", { name: /demo replay/i }));

    await vi.runAllTimersAsync();
    expect(calls.length).toBeGreaterThan(0);

    const order = calls.map((c) => c.split(" ")[1] ?? "");
    const resetIdx = order.findIndex((p) => p.includes("/demo-reset"));
    const decryptIdx = order.findIndex((p) => p.includes("/decrypt"));
    const payoutIdx = order.findIndex((p) => p.includes("/mock-anchor/payout"));
    expect(resetIdx).toBeLessThan(decryptIdx);
    expect(decryptIdx).toBeLessThan(payoutIdx);
    expect(payoutIdx).toBeGreaterThanOrEqual(0);
  });
});

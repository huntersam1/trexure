import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { ANCHOR_CALLBACK_TOKEN: "test-callback-token", APP_URL: "http://localhost:3000" },
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { triggerMockPayout } from "@/lib/anchor/mock";
import { verifyHmac } from "@/lib/webhooks/verify";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("triggerMockPayout", () => {
  it("POSTs a correctly-signed payment.completed event to /api/webhooks/fiat", async () => {
    const res = await triggerMockPayout({
      intentId: "intent_123",
      amount: "141750.00",
      currency: "PHP",
      recipientRef: "rcpt_1",
      delayMs: 0,
    });

    expect(res.status).toBe("completed");
    expect(res.providerRef).toMatch(/^mock_payout_/);
    expect(res.bankRef).toMatch(/^PH-BANK-/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/api/webhooks/fiat");
    expect(init.method).toBe("POST");

    const rawBody = init.body as string;
    const token = (init.headers as Record<string, string>)["x-callback-token"]!;
    // The signature must verify over the EXACT bytes that were sent.
    expect(verifyHmac(rawBody, token, mockEnv.ANCHOR_CALLBACK_TOKEN)).toBe(true);

    const sent = JSON.parse(rawBody);
    expect(sent.event).toBe("payment.completed");
    expect(sent.intentId).toBe("intent_123");
    expect(sent.providerRef).toBe(res.providerRef);
    expect(sent.bankRef).toBe(res.bankRef);
    expect(sent.id).toMatch(/^evt_mock_/);
  });

  it("emits payment.failed when fail:true", async () => {
    const res = await triggerMockPayout({
      intentId: "intent_123",
      amount: "141750.00",
      currency: "PHP",
      recipientRef: "rcpt_1",
      delayMs: 0,
      fail: true,
    });
    expect(res.status).toBe("failed");
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sent.event).toBe("payment.failed");
  });
});

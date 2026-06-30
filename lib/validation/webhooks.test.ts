import { describe, it, expect } from "vitest";
import {
  fiatWebhookSchema,
  chainWebhookSchema,
  mockPayoutSchema,
} from "@/lib/validation/webhooks";

const validFiat = {
  id: "evt_mock_abc",
  event: "payment.completed",
  intentId: "intent_123",
  providerRef: "mock_payout_xyz",
  bankRef: "PH-BANK-001",
  amount: "141750.00",
  currency: "PHP",
  fxRate: "56.70",
  anchorFee: "50.00",
  createdAt: "2026-07-15T08:21:03Z",
};

describe("fiatWebhookSchema", () => {
  it("accepts a well-formed §8.1 event", () => {
    expect(fiatWebhookSchema.parse(validFiat)).toMatchObject({ id: "evt_mock_abc" });
  });

  it("rejects unknown keys (.strict)", () => {
    expect(fiatWebhookSchema.safeParse({ ...validFiat, extra: 1 }).success).toBe(false);
  });

  it("rejects a non-decimal amount", () => {
    expect(fiatWebhookSchema.safeParse({ ...validFiat, amount: "abc" }).success).toBe(false);
  });

  it("rejects an unknown event type", () => {
    expect(fiatWebhookSchema.safeParse({ ...validFiat, event: "payment.pending" }).success).toBe(false);
  });
});

describe("chainWebhookSchema", () => {
  it("accepts a well-formed indexer push", () => {
    const ok = chainWebhookSchema.safeParse({
      id: "chain_evt_1",
      intentId: "intent_123",
      txHash: "abc123",
      ledger: 123456,
      contractId: "C...",
      proofHash: "deadbeef",
    });
    expect(ok.success).toBe(true);
  });
});

describe("mockPayoutSchema", () => {
  it("accepts minimal input and optional controls", () => {
    expect(mockPayoutSchema.parse({
      intentId: "intent_123",
      amount: "141750.00",
      currency: "PHP",
      recipientRef: "rcpt_1",
      delayMs: 0,
      fail: true,
    }).fail).toBe(true);
  });

  it("rejects unknown keys (.strict)", () => {
    expect(mockPayoutSchema.safeParse({
      intentId: "i", amount: "1", currency: "PHP", recipientRef: "r", oops: true,
    }).success).toBe(false);
  });
});

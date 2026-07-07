import { describe, it, expect } from "vitest";
import { buildShieldPayload } from "./shield-payload";
import type { CreatePaymentInput } from "../validation/payments";

const baseInput: CreatePaymentInput = {
  recipientRef: "contractor_ph_0042",
  amount: "2500.00",
  sourceAsset: "USDC",
  targetCurrency: "PHP",
  anchorId: "anchor_1",
};

describe("buildShieldPayload", () => {
  it("maps create-payment input to the canonical display shape the enclave UI reads", () => {
    const payload = buildShieldPayload(baseInput, {
      tenantName: "Trexure HQ",
      intentId: "intent_abc",
    });

    // These four keys are exactly what EnclavePanel / DecryptedPayload render.
    expect(payload.sender).toBe("Trexure HQ");
    expect(payload.recipient).toBe("contractor_ph_0042");
    expect(payload.asset).toBe("USDC");
    expect(payload.amount).toBe("2500.00");
  });

  it("keeps intentId in the payload so shield() can bind the ZK proof", () => {
    const payload = buildShieldPayload(baseInput, {
      tenantName: "Trexure HQ",
      intentId: "intent_abc",
    });
    expect(payload.intentId).toBe("intent_abc");
  });

  it("includes memo only when provided", () => {
    const without = buildShieldPayload(baseInput, { tenantName: "T", intentId: "i" });
    expect("memo" in without).toBe(false);

    const withMemo = buildShieldPayload(
      { ...baseInput, memo: "June payroll" },
      { tenantName: "T", intentId: "i" },
    );
    expect(withMemo.memo).toBe("June payroll");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { buildAndSubmitPrivatePayment, envMock } = vi.hoisted(() => ({
  buildAndSubmitPrivatePayment: vi.fn(),
  envMock: {
    SEED_ONCHAIN: false,
    STELLAR_SOURCE_SECRET: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // 56-char S… shape
    ZK_CONTRACT_ID: "CTEST_CONTRACT",
  },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/stellar/client", () => ({ buildAndSubmitPrivatePayment }));

import { buildSampleOnchainLeg } from "@/lib/payments/sample-onchain-leg";

const args = { intentId: "intent_x", amount: "2500.00", sourceAsset: "USDC", proofHash: "0xabc", placeholderRef: "pay_12345678" };

beforeEach(() => {
  vi.clearAllMocks();
  envMock.SEED_ONCHAIN = false;
  envMock.STELLAR_SOURCE_SECRET = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
});

describe("buildSampleOnchainLeg (#45)", () => {
  it("returns the offline placeholder leg by default (no submission)", async () => {
    const leg = await buildSampleOnchainLeg(args);
    expect(leg).toMatchObject({ status: "CONFIRMED", txHash: "demo_tx_pay_1234", ledger: 1234567, contractId: "CTEST_CONTRACT", mode: "placeholder" });
    expect(buildAndSubmitPrivatePayment).not.toHaveBeenCalled();
  });

  it("submits a REAL tx when SEED_ONCHAIN=true + a funded key", async () => {
    envMock.SEED_ONCHAIN = true;
    buildAndSubmitPrivatePayment.mockResolvedValue({ txHash: "abcdef123", ledger: 987654, contractId: "CREAL" });
    const leg = await buildSampleOnchainLeg(args);
    expect(buildAndSubmitPrivatePayment).toHaveBeenCalledWith({ intentId: "intent_x", amount: "2500.00", sourceAsset: "USDC", commitment: "0xabc" });
    expect(leg).toMatchObject({ status: "CONFIRMED", txHash: "abcdef123", ledger: 987654, contractId: "CREAL", mode: "real" });
  });

  it("falls back to placeholder when the real submit throws (never hard-fails)", async () => {
    envMock.SEED_ONCHAIN = true;
    buildAndSubmitPrivatePayment.mockRejectedValue(new Error("testnet down"));
    const leg = await buildSampleOnchainLeg(args);
    expect(leg.mode).toBe("placeholder");
    expect(leg.txHash).toBe("demo_tx_pay_1234");
  });

  it("uses placeholder when SEED_ONCHAIN=true but the key is not a valid secret", async () => {
    envMock.SEED_ONCHAIN = true;
    envMock.STELLAR_SOURCE_SECRET = "SCIXXXXXXXX"; // not a 56-char base32 seed
    const leg = await buildSampleOnchainLeg(args);
    expect(leg.mode).toBe("placeholder");
    expect(buildAndSubmitPrivatePayment).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { renderReceiptPdf } from "../../lib/pdf/receipt";

const RECEIPT = {
  id: "rcpt_demo",
  paymentId: "pay_demo",
  status: "settled",
  created: "2026-07-15T08:21:04Z",
  corridor: { from: "USD", to: "PHP" },
  amounts: {
    source: { currency: "USD", value: "2500.00" },
    destination: { currency: "PHP", value: "141750.00" },
  },
  fx: { rate: "56.70", asOf: "2026-07-15T08:20:55Z" },
  fees: { network: "0.00041 XLM", anchor: "PHP 50.00", platform: "0.00" },
  slippage: "0.0008",
  onchain: { txHash: "abc", ledger: 123456, proofHash: "def", asset: "USDC" },
  fiat: { provider: "mock-anchor", reference: "mock_x", bankRef: "PH-1" },
  privacy: { shielded: true, viewKeyDisclosed: false },
};

describe("renderReceiptPdf", () => {
  it("returns a non-empty PDF buffer starting with the %PDF header", async () => {
    const buf = await renderReceiptPdf(RECEIPT);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("does not embed any view-key material", async () => {
    const buf = await renderReceiptPdf(RECEIPT);
    const text = buf.toString("latin1");
    expect(text.toLowerCase()).not.toContain("viewkey");
  });
});

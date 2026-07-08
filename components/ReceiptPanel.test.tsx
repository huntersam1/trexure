// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { ReceiptPanel } from "@/components/ReceiptPanel";

afterEach(cleanup);

const fiatReceipt = {
  id: "rcpt_1",
  paymentId: "p1",
  status: "settled" as const,
  created: "2026-07-08T00:00:00Z",
  corridor: { from: "USD", to: "PHP" },
  amounts: { source: { currency: "USD", value: "2500.00" }, destination: { currency: "PHP", value: "141750.00" } },
  fx: { rate: "56.70", asOf: "now" },
  fees: { network: "0.00041 XLM", anchor: "PHP 50.00", platform: "0.00" },
  slippage: "0.0000",
  onchain: { txHash: "fiattx", ledger: 1, proofHash: "0xproof", asset: "USDC" },
  fiat: { provider: "mock-anchor", reference: "ref1", bankRef: "PH-BANK-1" },
  privacy: { shielded: true, viewKeyDisclosed: false },
};

// On-chain-only pool wallet receipt — no fx/fees/slippage/fiat blocks.
const poolWalletReceipt = {
  id: "rcpt_2",
  paymentId: "p2",
  status: "settled" as const,
  rail: "pool-wallet",
  created: "2026-07-08T00:00:00Z",
  corridor: { from: "XLM", to: "XLM" },
  amounts: { source: { currency: "XLM", value: "10.0000000" }, destination: { currency: "XLM", value: "10.0000000" } },
  onchain: { txHash: "pooltx", ledger: 2, nullifierHash: "0xnull", asset: "XLM" },
  privacy: { shielded: true, viewKeyDisclosed: false },
};

describe("ReceiptPanel", () => {
  it("renders a full fiat receipt with fx/fees/bank ref", () => {
    render(<ReceiptPanel receipt={fiatReceipt} />);
    expect(screen.getByText("FX Rate")).toBeTruthy();
    expect(screen.getByText("Anchor Fee")).toBeTruthy();
    expect(screen.getByText("PH-BANK-1")).toBeTruthy();
  });

  it("renders an on-chain-only pool receipt WITHOUT crashing (no fx/fees/fiat)", () => {
    // Regression: previously threw "Cannot read properties of undefined (reading 'rate')".
    render(<ReceiptPanel receipt={poolWalletReceipt} />);
    expect(screen.getByText("pooltx")).toBeTruthy(); // tx id still shown
    expect(screen.getByText("Nullifier")).toBeTruthy(); // shown in place of bank ref
    expect(screen.queryByText("FX Rate")).toBeNull();
    expect(screen.queryByText("Anchor Fee")).toBeNull();
    expect(screen.queryByText("Bank Reference")).toBeNull();
  });
});

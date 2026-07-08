// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PoolReceiptCard } from "@/components/pool/PoolReceiptCard";
import { Timeline } from "@/components/pool/Timeline";

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

describe("PoolReceiptCard", () => {
  it("renders an on-chain-only (wallet) receipt without a fiat block", () => {
    render(
      <PoolReceiptCard
        receipt={{
          rail: "pool-wallet",
          corridor: { from: "XLM", to: "XLM" },
          amounts: { source: { currency: "XLM", value: "10.0000000" }, destination: { currency: "XLM", value: "10.0000000" } },
          onchain: { txHash: "abc123", nullifierHash: "0xnull" },
          privacy: { shielded: true, viewKeyDisclosed: false },
        }}
      />,
    );
    expect(screen.getByText(/On-chain settled/)).toBeTruthy();
    expect(screen.getByText("Nullifier")).toBeTruthy();
    // No fiat block → no bank ref / anchor fee rows.
    expect(screen.queryByText("Bank ref")).toBeNull();
    expect(screen.queryByText("Anchor fee")).toBeNull();
  });

  it("renders a full fiat (bank) receipt with the fiat block", () => {
    render(
      <PoolReceiptCard
        receipt={{
          corridor: { from: "XLM", to: "PHP" },
          amounts: { source: { currency: "XLM", value: "2.00" }, destination: { currency: "PHP", value: "12.48" } },
          fx: { rate: "6.24", asOf: "now" },
          fees: { network: "0.00041 XLM", anchor: "PHP 50.00", platform: "0.00" },
          slippage: "0.0000",
          onchain: { txHash: "onc" },
          fiat: { provider: "mock-anchor", reference: "ref1", bankRef: "PH-BANK-1" },
          privacy: { shielded: true, viewKeyDisclosed: false },
        }}
      />,
    );
    expect(screen.getByText(/Bank payout settled/)).toBeTruthy();
    expect(screen.getByText(/12\.48/)).toBeTruthy();
    expect(screen.getByText("Anchor fee")).toBeTruthy();
    expect(screen.getByText("PH-BANK-1")).toBeTruthy();
  });
});

describe("Timeline", () => {
  it("marks steps done up to the current status", () => {
    const { container } = render(<Timeline status="ONCHAIN_CONFIRMED" />);
    // Created + On-chain confirmed = 2 done steps.
    expect(container.querySelectorAll('[data-state="done"]').length).toBe(2);
    expect(screen.getByText("Settled")).toBeTruthy();
  });

  it("shows a failed marker for FAILED", () => {
    render(<Timeline status="FAILED" />);
    expect(screen.getByText(/payout did not complete/)).toBeTruthy();
  });
});

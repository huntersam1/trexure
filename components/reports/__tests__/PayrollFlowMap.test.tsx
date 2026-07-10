// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

import { PayrollFlowMap } from "../PayrollFlowMap";
import type { PayrollFlow } from "@/lib/reports/payroll-flow";

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

beforeAll(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = RO as never;
});

const FLOW: PayrollFlow = {
  disbursementCount: 3,
  totals: [{ currency: "XLM", total: "45" }],
  batches: [
    {
      batchId: "b1",
      createdAt: "2026-07-04T12:00:00.000Z",
      createdByUsername: "payroll-admin",
      count: 2,
      totalSourceAmount: "30",
      claimed: 1,
      unclaimed: 1,
      failed: 0,
      destTypes: ["WALLET", "PENDING"],
      groups: [
        {
          type: "WALLET",
          count: 1,
          totals: [{ currency: "XLM", total: "10" }],
          leaves: [
            {
              paymentId: "p1",
              batchId: "b1",
              receiver: "Alice",
              amount: "10 XLM",
              detail: "tx txhash_a…",
              href: "/pool/batches/b1/p1",
            },
          ],
        },
        {
          type: "PENDING",
          count: 1,
          totals: [{ currency: "XLM", total: "20" }],
          leaves: [
            {
              paymentId: "p2",
              batchId: "b1",
              receiver: "Carol",
              amount: "20 XLM",
              detail: "unclaimed 6d",
              href: "/pool/batches/b1/p2",
            },
          ],
        },
      ],
    },
    {
      batchId: "b2",
      createdAt: "2026-07-06T12:00:00.000Z",
      createdByUsername: "payroll-admin",
      count: 1,
      totalSourceAmount: "15",
      claimed: 0,
      unclaimed: 0,
      failed: 1,
      destTypes: ["FAILED"],
      groups: [
        {
          type: "FAILED",
          count: 1,
          totals: [{ currency: "XLM", total: "15" }],
          leaves: [
            {
              paymentId: "p3",
              batchId: "b2",
              receiver: "Dave",
              amount: "15 XLM",
              detail: "failed",
              href: "/pool/batches/b2/p3",
            },
          ],
        },
      ],
    },
  ],
};

describe("PayrollFlowMap", () => {
  it("renders the treasury root with totals and one collapsed pill per batch", () => {
    render(<PayrollFlowMap flow={FLOW} scopedBatchId={null} />);
    expect(screen.getByText("Treasury")).not.toBeNull();
    expect(screen.getByText(/3 disbursements/)).not.toBeNull();
    expect(screen.getByText(/45 XLM/)).not.toBeNull();
    // Collapsed: no leaves visible.
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Batch/ })).toHaveLength(2);
  });

  it("expands a batch on click, showing destination groups and leaf links", () => {
    render(<PayrollFlowMap flow={FLOW} scopedBatchId={null} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Batch/ })[0]);

    // Scope to the tree container — the legend in the header repeats these labels.
    const tree = within(screen.getByTestId("flow-tree"));
    expect(tree.getByText("On-chain wallet")).not.toBeNull();
    expect(tree.getByText("Pending claim")).not.toBeNull();
    // Empty groups hidden: b1 has no BANK or FAILED branch.
    expect(tree.queryByText("Bank / fiat off-ramp")).toBeNull();
    expect(tree.queryByText("Failed")).toBeNull();

    const leaf = screen.getByText("Alice").closest("a");
    expect(leaf?.getAttribute("href")).toBe("/pool/batches/b1/p1");
    expect(screen.getByText("unclaimed 6d")).not.toBeNull();

    // Collapse again.
    fireEvent.click(screen.getAllByRole("button", { name: /Batch/ })[0]);
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("auto-expands the scoped batch", () => {
    render(<PayrollFlowMap flow={FLOW} scopedBatchId="b2" />);
    expect(screen.getByText("Dave").closest("a")?.getAttribute("href")).toBe("/pool/batches/b2/p3");
    expect(screen.queryByText("Alice")).toBeNull(); // b1 stays collapsed
  });

  it("shows a tooltip with the claim breakdown on the batch pill", () => {
    render(<PayrollFlowMap flow={FLOW} scopedBatchId={null} />);
    expect(screen.getByText(/1 claimed · 1 unclaimed · 0 failed/)).not.toBeNull();
  });

  it("renders an empty note when there are no batches", () => {
    render(
      <PayrollFlowMap
        flow={{ disbursementCount: 0, totals: [], batches: [] }}
        scopedBatchId={null}
      />,
    );
    expect(screen.getByText(/No disbursements in this scope/)).not.toBeNull();
  });
});

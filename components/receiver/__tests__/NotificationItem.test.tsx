// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NotificationItem } from "../NotificationItem";
import type { ReceiverNotification } from "@/lib/receiver/notifications";

// vitest globals:false disables Testing Library's automatic cleanup.
afterEach(cleanup);

function make(overrides: Partial<ReceiverNotification> = {}): ReceiverNotification {
  return {
    id: "n1",
    paymentId: "p1",
    read: false,
    claimed: false,
    createdAt: new Date(0),
    payment: {
      sourceAmount: "10",
      sourceAsset: "XLM",
      status: "PENDING",
      batchId: "b1",
      payerName: "Acme Payer",
    },
    ...overrides,
  };
}

describe("NotificationItem (#82)", () => {
  it("shows an unread marker and a deep-link to claim when unread + unclaimed", () => {
    render(
      <ul>
        <NotificationItem n={make()} />
      </ul>,
    );
    expect(screen.getByLabelText("Unread")).not.toBeNull();
    expect(screen.getByText(/Acme Payer/)).not.toBeNull();
    const claim = screen.getByText("Claim").closest("a");
    expect(claim?.getAttribute("href")).toBe("/claim");
  });

  it("hides the unread marker once read", () => {
    render(
      <ul>
        <NotificationItem n={make({ read: true })} />
      </ul>,
    );
    expect(screen.queryByLabelText("Unread")).toBeNull();
  });

  it("badges a claimed disbursement and drops the claim link", () => {
    render(
      <ul>
        <NotificationItem n={make({ read: true, claimed: true })} />
      </ul>,
    );
    expect(screen.getByText("Claimed")).not.toBeNull();
    expect(screen.queryByText("Claim")).toBeNull();
  });
});

import type { JSX } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import type { ReceiverNotification } from "@/lib/receiver/notifications";

/**
 * One row in the receiver claim inbox (#82). References the disbursement only —
 * amount, payer, status — never the bearer note. Unclaimed rows deep-link into
 * the claim form; claimed rows are badged and inert.
 */
export function NotificationItem({ n }: { n: ReceiverNotification }): JSX.Element {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        n.read ? "border-outline-variant bg-surface" : "border-primary/40 bg-primary-container/40"
      }`}
    >
      {!n.read && (
        <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body-md text-on-surface">
          <span className="font-bold">
            {n.payment.sourceAmount} {n.payment.sourceAsset}
          </span>{" "}
          from {n.payment.payerName || "a Trexure workspace"}
        </p>
        <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">
          {n.payment.status}
        </p>
      </div>
      {n.claimed ? (
        <span className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant">
          <Icon name="check_circle" className="text-[18px]" />
          Claimed
        </span>
      ) : (
        <Link
          href="/claim"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-body-sm font-bold text-on-primary hover:opacity-90"
        >
          Claim
          <Icon name="arrow_forward" className="text-[18px]" />
        </Link>
      )}
    </li>
  );
}

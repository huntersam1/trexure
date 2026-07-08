import type { JSX } from "react";

import { Icon } from "@/components/ui/Icon";
import type { PaymentStatus } from "@/lib/ui/types";

/**
 * Payment lifecycle timeline (P6, #88): PENDING → ONCHAIN_CONFIRMED →
 * RECONCILING → SETTLED. A wallet claim (Rail A) jumps straight to SETTLED on
 * withdraw; a bank claim walks the reconcile step. FAILED is rendered distinctly.
 */
const STEPS: { status: PaymentStatus; label: string }[] = [
  { status: "PENDING", label: "Created" },
  { status: "ONCHAIN_CONFIRMED", label: "On-chain confirmed" },
  { status: "RECONCILING", label: "Reconciling" },
  { status: "SETTLED", label: "Settled" },
];

const ORDER: PaymentStatus[] = ["PENDING", "ONCHAIN_CONFIRMED", "RECONCILING", "SETTLED"];

export function Timeline({ status }: { status: PaymentStatus }): JSX.Element {
  const failed = status === "FAILED";
  const currentIdx = ORDER.indexOf(status);

  return (
    <ol className="flex flex-col gap-0" aria-label="Payment timeline">
      {STEPS.map((step, i) => {
        const done = !failed && currentIdx >= i;
        const active = !failed && currentIdx === i;
        return (
          <li key={step.status} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <span
                data-state={done ? "done" : "todo"}
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[16px] ${
                  done
                    ? "bg-primary text-on-primary border-primary"
                    : "bg-surface text-on-surface-variant border-outline-variant"
                }`}
              >
                <Icon name={done ? "check" : "radio_button_unchecked"} className="text-[16px]" />
              </span>
              {i < STEPS.length - 1 && (
                <span className={`w-px flex-1 min-h-6 ${done ? "bg-primary/50" : "bg-outline-variant"}`} />
              )}
            </div>
            <span className={`pt-1 text-body-sm ${active ? "text-on-surface font-medium" : "text-on-surface-variant"}`}>
              {step.label}
            </span>
          </li>
        );
      })}
      {failed && (
        <li className="mt-2 flex items-center gap-2 text-body-sm text-error">
          <Icon name="error" className="text-[18px]" />
          Failed — payout did not complete.
        </li>
      )}
    </ol>
  );
}

import type { JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { statusToBadge } from "@/lib/ui/status";
import type { BadgeState, PaymentStatus } from "@/lib/ui/types";

export function StatusBadge({ status }: { status: PaymentStatus | BadgeState }): JSX.Element {
  const b = statusToBadge(status);
  return (
    <span
      data-state={b.state}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${b.classes}`}
    >
      <Icon
        name={b.icon}
        className={`text-[12px] leading-none ${b.spinner ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
      {b.label}
    </span>
  );
}

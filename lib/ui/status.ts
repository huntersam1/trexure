import type { BadgeState, PaymentStatus } from "@/lib/ui/types";

type BadgeSpec = { state: BadgeState; label: string; classes: string; icon: string; spinner: boolean };

const SPEC: Record<BadgeState, Omit<BadgeSpec, "state">> = {
  PENDING: {
    label: "PENDING",
    classes: "bg-surface-container-highest text-on-surface-variant",
    icon: "schedule",
    spinner: false,
  },
  VERIFIED: {
    label: "VERIFIED",
    classes: "bg-primary/20 text-primary",
    icon: "verified",
    spinner: false,
  },
  RECONCILING: {
    label: "RECONCILING",
    classes: "bg-primary/10 text-primary",
    icon: "sync",
    spinner: true,
  },
  SETTLED: {
    label: "SETTLED",
    classes: "bg-accent/20 text-accent",
    icon: "check",
    spinner: false,
  },
  FAILED: {
    label: "FAILED",
    classes: "bg-error-container text-error",
    icon: "error",
    spinner: false,
  },
};

function toBadgeState(status: PaymentStatus | BadgeState): BadgeState {
  switch (status) {
    case "DRAFT":
    case "PENDING":
      return "PENDING";
    case "ONCHAIN_CONFIRMED":
    case "VERIFIED":
      return "VERIFIED";
    case "RECONCILING":
      return "RECONCILING";
    case "SETTLED":
      return "SETTLED";
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

export function statusToBadge(status: PaymentStatus | BadgeState): BadgeSpec {
  const state = toBadgeState(status);
  return { state, ...SPEC[state] };
}

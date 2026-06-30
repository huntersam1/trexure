import type { JSX } from "react";
import { Icon } from "@/components/ui/Icon";

const EMPHASIS: Record<"primary" | "accent" | "neutral", string> = {
  primary: "text-primary",
  accent: "text-accent",
  neutral: "text-on-surface",
};

export function KpiStat({
  label,
  value,
  icon,
  emphasis = "neutral",
}: {
  label: string;
  value: string;
  icon: string;
  emphasis?: "primary" | "accent" | "neutral";
}): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
      <div className="flex items-center justify-between">
        <p className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{label}</p>
        <Icon name={icon} className="text-[20px] text-on-surface-variant/50" />
      </div>
      <p className={`mt-4 font-geist text-headline-lg ${EMPHASIS[emphasis]}`}>{value}</p>
    </div>
  );
}

"use client";

import type { JSX } from "react";
import { Icon } from "@/components/ui/Icon";

export function TransactionCard({
  rows,
  shielded,
}: {
  rows: { label: string; value: string }[];
  shielded: boolean;
}): JSX.Element {
  return (
    <div className="relative bg-surface-container-low rounded-lg border border-outline-variant p-6">
      {shielded && (
        // Lock overlay + restricted label — the non-blur "hidden" cue required by BRAND §9/§10.
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-surface/40">
          <Icon name="lock" className="text-[32px] text-accent" />
          <span className="text-label-mono uppercase tracking-widest font-bold text-accent">Restricted — Shielded</span>
        </div>
      )}
      <dl className={`grid grid-cols-1 gap-3 ${shielded ? "trx-blurred trx-shimmer" : "trx-revealed"}`}>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <dt className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{r.label}</dt>
            <dd className="font-mono text-code-block text-on-surface/80 break-all text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

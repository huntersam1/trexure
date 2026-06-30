"use client";

import type { JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { truncateHash } from "@/lib/ui/format";

function LegCard({
  icon,
  title,
  refLabel,
  refValue,
  tone,
  state,
}: {
  icon: string;
  title: string;
  refLabel: string;
  refValue: string;
  tone: "primary" | "accent";
  state: "PENDING" | "VERIFIED" | "SETTLED";
}): JSX.Element {
  const ring = tone === "primary" ? "bg-primary text-on-primary" : "bg-accent text-on-primary";
  return (
    <div className="flex-1 bg-surface border border-outline rounded-xl p-6 shadow-xl shadow-black/5 trx-view-enter">
      <div className="flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${ring}`}>
          <Icon name={icon} fill className="text-[20px]" />
        </span>
        <StatusBadge status={state} />
      </div>
      <p className="mt-4 text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{title}</p>
      <p className="mt-1 text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/50">{refLabel}</p>
      <p className="mt-0.5 font-mono text-code-block text-on-surface/80 break-all">{truncateHash(refValue, 10, 6)}</p>
    </div>
  );
}

export function ReconciliationRow({
  onchainRef,
  fiatRef,
  matched,
  reconciling,
}: {
  onchainRef: string;
  fiatRef: string;
  matched: boolean;
  reconciling: boolean;
}): JSX.Element {
  return (
    <div className="relative flex items-stretch gap-6">
      <LegCard
        icon="hub"
        title="On-Chain Leg"
        refLabel="TX Hash"
        refValue={onchainRef}
        tone="primary"
        state={matched ? "VERIFIED" : "PENDING"}
      />

      {/* center drawing line + matching engine pill */}
      <div className="flex flex-col items-center justify-center w-32 shrink-0">
        <div className="relative h-24 w-0.5 bg-outline-variant overflow-hidden">
          <div
            className="absolute top-0 left-0 w-full bg-primary trx-line-draw"
            style={{ height: matched ? "100%" : "0%" }}
          />
        </div>
        {reconciling && !matched && (
          <span className="mt-3 inline-flex items-center gap-1.5 bg-primary/10 text-primary rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide">
            <Icon name="sync" className="text-[12px] animate-spin motion-reduce:animate-none" />
            Matching Engine
          </span>
        )}
        {matched && (
          <span className="mt-3 inline-flex items-center gap-1.5 bg-accent/20 text-accent rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide">
            <Icon name="link" className="text-[12px]" />
            Matched 1:1
          </span>
        )}
      </div>

      <LegCard
        icon="account_balance"
        title="Fiat Leg"
        refLabel="Bank Ref"
        refValue={fiatRef}
        tone="accent"
        state={matched ? "SETTLED" : "PENDING"}
      />
    </div>
  );
}

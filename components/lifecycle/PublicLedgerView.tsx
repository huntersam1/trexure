"use client";

import type { JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { TransactionCard } from "@/components/TransactionCard";

export function PublicLedgerView({
  proofHash,
  shieldedRows,
}: {
  proofHash: string | null;
  shieldedRows: { label: string; value: string }[];
}): JSX.Element {
  return (
    <div className="trx-view-enter flex flex-col gap-stack-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-geist text-headline-md text-on-surface">Public Ledger View</h2>
          <span className="inline-flex items-center gap-1.5 bg-accent/10 text-accent border border-accent/30 rounded-full px-3 py-1 text-label-mono font-bold">
            <Icon name="lock" className="text-[14px]" />
            Shielded
          </span>
        </div>
      </div>
      <p className="text-body-md text-on-surface-variant max-w-2xl">
        This is everything a competitor scraping the public Stellar ledger can see. No sender, no recipient, no amount — only a verified proof.
      </p>

      <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5 flex flex-col gap-stack-md">
        <div>
          <p className="text-label-mono uppercase tracking-widest font-bold text-primary/70">Proof Hash</p>
          <p className="mt-1 font-mono text-code-block break-all text-on-surface/80">
            {proofHash ?? "awaiting on-chain confirmation…"}
          </p>
        </div>
        <TransactionCard rows={shieldedRows} shielded />
      </div>
    </div>
  );
}

"use client";

import { useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { CopyButton } from "@/components/ui/CopyButton";
import type { Receipt } from "@/lib/ui/types";

function Line({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-outline-variant last:border-0">
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className="font-mono text-body-sm text-on-surface">{value}</span>
    </div>
  );
}

// A settled pool **wallet** claim emits an on-chain-only receipt (rail
// "pool-wallet") with no fx/fees/slippage/fiat blocks — pool disbursements are
// regular Payments, so they also render here at /payments/[id]. Accept those
// blocks as optional and hide their rows when absent (fiat receipts unchanged).
type DisplayReceipt = Omit<Receipt, "fx" | "fees" | "slippage" | "fiat" | "onchain"> &
  Partial<Pick<Receipt, "fx" | "fees" | "slippage" | "fiat">> & {
    // The on-chain-only pool receipt carries `nullifierHash` and no `proofHash`,
    // so both are optional here (the fiat receipt still supplies `proofHash`).
    onchain: Omit<Receipt["onchain"], "proofHash"> & { proofHash?: string; nullifierHash?: string };
  };

export function ReceiptPanel({ receipt, onExport }: { receipt: DisplayReceipt; onExport?: () => void }): JSX.Element {
  const [showJson, setShowJson] = useState(false);
  const json = JSON.stringify(receipt, null, 2);

  return (
    <div className="trx-view-enter flex flex-col items-center gap-stack-md">
      <div className="w-full max-w-md rounded-2xl shadow-2xl border-t-4 border-t-primary bg-surface overflow-hidden">
        {/* header band */}
        <div className="bg-surface-container-low px-8 py-6 border-b border-outline-variant">
          <div className="flex items-center justify-between">
            <span className="font-geist text-headline-md font-[800] tracking-tight text-on-surface">Trexure</span>
            <span className="inline-flex items-center gap-1.5 bg-accent/20 text-accent rounded-full px-3 py-1 text-label-mono font-bold">
              <Icon name="check" className="text-[14px]" />
              Payment Confirmed
            </span>
          </div>
          <p className="mt-4 font-geist text-display-lg text-on-surface">
            {receipt.amounts.destination.value} {receipt.amounts.destination.currency}
          </p>
        </div>

        {/* body */}
        <div className="px-8 py-6">
          <Line label="Corridor" value={`${receipt.corridor.from} → ${receipt.corridor.to}`} />
          <Line label="Source" value={`${receipt.amounts.source.value} ${receipt.amounts.source.currency}`} />
          {receipt.fx && <Line label="FX Rate" value={`${receipt.fx.rate}`} />}
          {receipt.fees && <Line label="Network Fee" value={receipt.fees.network} />}
          {receipt.fees && <Line label="Anchor Fee" value={receipt.fees.anchor} />}
          {receipt.fees && <Line label="Platform Fee" value={receipt.fees.platform} />}
          {receipt.slippage != null && <Line label="Slippage" value={receipt.slippage} />}

          <div className="mt-4 flex items-center justify-between">
            <span className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">Total Settled</span>
            <span className="font-geist text-headline-md text-primary font-bold">
              {receipt.amounts.destination.value} {receipt.amounts.destination.currency}
            </span>
          </div>

          <div className="mt-6 bg-surface-container-low rounded-lg border border-outline-variant p-4">
            <p className="text-label-mono uppercase tracking-widest font-bold text-primary/70">Transaction ID</p>
            <p className="mt-1 font-mono text-code-block break-all text-on-surface/80">{receipt.onchain.txHash}</p>
            {receipt.fiat?.bankRef ? (
              <>
                <p className="mt-2 text-label-mono uppercase tracking-widest font-bold text-primary/70">Bank Reference</p>
                <p className="mt-1 font-mono text-code-block break-all text-on-surface/80">{receipt.fiat.bankRef}</p>
              </>
            ) : receipt.onchain.nullifierHash ? (
              <>
                <p className="mt-2 text-label-mono uppercase tracking-widest font-bold text-primary/70">Nullifier</p>
                <p className="mt-1 font-mono text-code-block break-all text-on-surface/80">{receipt.onchain.nullifierHash}</p>
              </>
            ) : null}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <CopyButton text={json} />
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center gap-2 rounded-lg bg-surface border border-primary/20 text-primary px-4 py-2 text-body-sm transition-all active:scale-95 hover:bg-primary hover:text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon name="picture_as_pdf" className="text-[16px]" />
              Export PDF
            </button>
          </div>
        </div>

        {/* footer */}
        <div className="px-8 py-3 border-t border-outline-variant">
          <p className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/50 text-center">
            Secured by Enclave Protocol
          </p>
        </div>
      </div>

      {/* collapsible raw JSON */}
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="inline-flex items-center gap-2 text-body-sm text-on-surface-variant hover:text-primary"
          aria-expanded={showJson}
        >
          <Icon name={showJson ? "expand_less" : "expand_more"} className="text-[18px]" />
          {showJson ? "Hide raw JSON" : "Show raw JSON"}
        </button>
        {showJson && (
          <pre className="mt-2 trx-scroll max-h-80 overflow-auto rounded-lg bg-inverse-surface text-on-inverse-surface p-4 font-mono text-code-block">
            {json}
          </pre>
        )}
      </div>
    </div>
  );
}

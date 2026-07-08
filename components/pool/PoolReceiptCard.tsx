import type { JSX } from "react";

import { Icon } from "@/components/ui/Icon";

/**
 * Renders a settled receipt for a pool payment (P6, #88). Handles BOTH shapes:
 * the on-chain-only wallet receipt (`rail: "pool-wallet"`, no fiat/fx/fees) and
 * the full fiat receipt (bank claim). Fields are read defensively so a missing
 * block simply hides its rows.
 */
export type ReceiptLike = {
  id?: string;
  rail?: string;
  corridor?: { from: string; to: string };
  amounts?: {
    source?: { currency: string; value: string };
    destination?: { currency: string; value: string };
  };
  fx?: { rate: string; asOf: string };
  fees?: { network: string; anchor: string; platform: string };
  slippage?: string;
  onchain?: { txHash?: string; ledger?: number; proofHash?: string; nullifierHash?: string; asset?: string };
  fiat?: { provider?: string; reference?: string; bankRef?: string };
  privacy?: { shielded?: boolean; viewKeyDisclosed?: boolean };
};

function Line({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-outline-variant last:border-0">
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className="font-mono text-body-sm text-on-surface break-all text-right">{value}</span>
    </div>
  );
}

export function PoolReceiptCard({ receipt }: { receipt: ReceiptLike }): JSX.Element {
  const dest = receipt.amounts?.destination;
  const src = receipt.amounts?.source;
  const isBank = Boolean(receipt.fiat);

  return (
    <div className="w-full max-w-md rounded-2xl border-t-4 border-t-primary bg-surface shadow-xl shadow-black/5 overflow-hidden">
      <div className="bg-surface-container-low px-6 py-5 border-b border-outline-variant">
        <div className="flex items-center justify-between">
          <span className="font-geist text-title-lg font-[800] tracking-tight text-on-surface">Trexure</span>
          <span className="inline-flex items-center gap-1.5 bg-accent/20 text-accent rounded-full px-3 py-1 text-label-mono font-bold">
            <Icon name="check" className="text-[14px]" />
            {isBank ? "Bank payout settled" : "On-chain settled"}
          </span>
        </div>
        <p className="mt-3 font-geist text-headline-lg text-on-surface">
          {dest?.value ?? "—"} {dest?.currency ?? ""}
        </p>
      </div>

      <div className="px-6 py-5">
        {receipt.corridor && <Line label="Corridor" value={`${receipt.corridor.from} → ${receipt.corridor.to}`} />}
        {src && <Line label="Source" value={`${src.value} ${src.currency}`} />}
        {receipt.fx && <Line label="FX rate" value={receipt.fx.rate} />}
        {receipt.fees && <Line label="Network fee" value={receipt.fees.network} />}
        {receipt.fees && <Line label="Anchor fee" value={receipt.fees.anchor} />}
        {receipt.slippage != null && <Line label="Slippage" value={receipt.slippage} />}
        {receipt.onchain?.txHash && <Line label="On-chain tx" value={receipt.onchain.txHash} />}
        {receipt.onchain?.nullifierHash && <Line label="Nullifier" value={receipt.onchain.nullifierHash} />}
        {receipt.fiat?.bankRef && <Line label="Bank ref" value={receipt.fiat.bankRef} />}
        {receipt.fiat?.provider && <Line label="Provider" value={receipt.fiat.provider} />}
        <Line label="Privacy" value={receipt.privacy?.shielded ? "Shielded" : "—"} />
      </div>
    </div>
  );
}

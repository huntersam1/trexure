"use client";

import { useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { apiPost, ApiError } from "@/lib/api/client";
import type { DecryptedPayload } from "@/lib/ui/types";

export function EnclavePanel({
  paymentId,
  csrfToken,
  onDecrypted,
  decrypted,
}: {
  paymentId: string;
  csrfToken: string;
  onDecrypted: (p: DecryptedPayload) => void;
  decrypted: DecryptedPayload | null;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyViewKey() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<{ payload: DecryptedPayload }>(`/api/payments/${paymentId}/decrypt`, {}, csrfToken);
      onDecrypted(res.payload);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Decryption failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="trx-view-enter flex flex-col gap-stack-md">
      <h2 className="font-geist text-headline-md text-on-surface">Internal Enclave</h2>
      <p className="text-body-md text-on-surface-variant max-w-2xl">
        The company holds its own view key. The key is decrypted and applied server-side — it never leaves the server and is never shown here.
      </p>

      {!decrypted ? (
        <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5 flex flex-col items-center gap-4">
          <Icon name="vpn_key" className="text-[32px] text-primary" />
          <button
            type="button"
            onClick={applyViewKey}
            disabled={loading}
            className="bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {loading ? "Applying…" : "Apply View Key"}
          </button>
          {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
        </div>
      ) : (
        <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5 flex flex-col gap-stack-md">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 bg-primary-container text-primary border border-primary/20 rounded-lg px-3 py-1.5 text-label-mono font-bold">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />
              VIEW KEY: 0x…K91
            </span>
            <span className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">Decrypted in enclave</span>
          </div>
          <dl className="trx-revealed grid grid-cols-1 gap-3">
            {[
              { label: "Sender", value: decrypted.sender },
              { label: "Recipient", value: decrypted.recipient },
              { label: "Asset", value: decrypted.asset },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 border-b border-outline-variant pb-3">
                <dt className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{r.label}</dt>
                <dd className="font-mono text-code-block text-on-surface/80 break-all text-right">{r.value}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4">
              <dt className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">Amount</dt>
              <dd className="font-geist text-headline-md text-primary font-bold">{decrypted.amount}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

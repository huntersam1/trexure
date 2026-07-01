"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { Stepper } from "@/components/ui/Stepper";
import { PublicLedgerView } from "@/components/lifecycle/PublicLedgerView";
import { EnclavePanel } from "@/components/lifecycle/EnclavePanel";
import { ReconciliationRow } from "@/components/ReconciliationRow";
import { ReceiptPanel } from "@/components/ReceiptPanel";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import type { DecryptedPayload, PaymentDetail, Receipt } from "@/lib/ui/types";

type PaymentPoll = { status: PaymentDetail["status"]; legs: PaymentDetail["legs"]; hasReceipt: boolean };

export function PaymentLifecycle({
  payment,
  initialReceipt,
  csrfToken,
}: {
  payment: PaymentDetail;
  initialReceipt: Receipt | null;
  csrfToken: string;
}): JSX.Element {
  const onchainLeg = payment.legs.find((l) => l.legType === "ONCHAIN");
  const fiatLeg = payment.legs.find((l) => l.legType === "FIAT");

  const settledInitially = payment.status === "SETTLED";
  const [decrypted, setDecrypted] = useState<DecryptedPayload | null>(null);
  const [step, setStep] = useState<number>(settledInitially ? 3 : 0);
  const [reconciling, setReconciling] = useState(false);
  const [matched, setMatched] = useState(settledInitially);
  const [receipt, setReceipt] = useState<Receipt | null>(initialReceipt);
  const [fiatRef, setFiatRef] = useState<string>(fiatLeg?.bankRef ?? "—");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Beat 1 shielded rows (decoy values; nothing real is legible).
  const shieldedRows = [
    { label: "Sender", value: "••••••••••••••••" },
    { label: "Recipient", value: "••••••••••••••••" },
    { label: "Amount", value: "••••••••" },
  ];

  const onDecrypted = useCallback((p: DecryptedPayload) => {
    setDecrypted(p);
    setStep((s) => Math.max(s, 1));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchReceipt = useCallback(async () => {
    try {
      const r = await apiGet<Receipt>(`/api/payments/${payment.id}/receipt`);
      setReceipt(r);
    } catch {
      /* receipt may lag a beat; the page revalidates on next load */
    }
  }, [payment.id]);

  // Beat 3: trigger the mock payout, then poll the payment until SETTLED.
  async function triggerPayout() {
    setError(null);
    setReconciling(true);
    setStep((s) => Math.max(s, 2));
    try {
      // Instruct the anchor with the quoted DESTINATION amount (PHP), not the
      // USD source amount — the webhook's amount is what lands on the receipt.
      await apiPost(`/api/mock-anchor/payout`, { intentId: payment.intentId, amount: payment.targetAmount ?? payment.sourceAmount, currency: payment.targetCurrency, recipientRef: payment.id, delayMs: 1500 }, csrfToken);
    } catch (e) {
      setReconciling(false);
      setError(e instanceof ApiError ? e.message : "Could not trigger payout.");
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const p = await apiGet<PaymentPoll>(`/api/payments/${payment.id}`);
        const fiat = p.legs.find((l) => l.legType === "FIAT");
        if (fiat?.bankRef) setFiatRef(fiat.bankRef);
        if (p.status === "FAILED") {
          stopPolling();
          setReconciling(false);
          setError("Payout failed. Use Retry Reconcile to recover.");
        }
        if (p.status === "SETTLED") {
          stopPolling();
          setReconciling(false);
          setMatched(true);
          setStep(3);
          await fetchReceipt();
        }
      } catch {
        /* transient; keep polling */
      }
    }, 1500);
  }

  useEffect(() => stopPolling, [stopPolling]);

  const canTriggerPayout = step >= 1; // gated: decrypt enables reconciliation
  const canSeeReceipt = matched && receipt != null; // gated: settle enables receipt

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">Payment Lifecycle</h1>
          <p className="mt-1 font-mono text-body-sm text-on-surface-variant">intent: {payment.intentId}</p>
        </div>
      </div>

      <Stepper current={step} />

      {error && (
        <p role="alert" className="text-body-sm text-error bg-error-container rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Beat 1 */}
      <PublicLedgerView proofHash={payment.proofHash} shieldedRows={shieldedRows} />

      {/* Beat 2 */}
      <EnclavePanel paymentId={payment.id} csrfToken={csrfToken} onDecrypted={onDecrypted} decrypted={decrypted} />

      {/* Beat 3 */}
      <div className="flex flex-col gap-stack-md">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-headline-md text-on-surface">Auto-Reconciliation</h2>
          <button
            type="button"
            onClick={triggerPayout}
            disabled={!canTriggerPayout || reconciling || matched}
            className={
              !canTriggerPayout || reconciling || matched
                ? "bg-surface-container-highest text-on-surface-variant opacity-50 cursor-not-allowed rounded-lg font-bold px-6 py-2.5"
                : "bg-accent text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-accent/20 hover:opacity-90 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            }
          >
            {matched ? "Settled" : reconciling ? "Reconciling…" : "Trigger Payout"}
          </button>
        </div>
        <ReconciliationRow
          onchainRef={onchainLeg?.txHash ?? payment.proofHash ?? "pending"}
          fiatRef={fiatRef}
          matched={matched}
          reconciling={reconciling}
        />
      </div>

      {/* Beat 4 (gated) */}
      {canSeeReceipt ? (
        <ReceiptPanel receipt={receipt!} />
      ) : (
        <div className="bg-surface-container-low border border-outline-variant rounded-xl p-8 text-center">
          <Icon name="receipt_long" className="text-[32px] text-on-surface-variant/40" />
          <p className="mt-2 text-body-sm text-on-surface-variant">Receipt unlocks once the payment settles.</p>
        </div>
      )}

      {/* Advanced drawer — blockchain detail hidden by default (SPEC §4) */}
      <div className="border-t border-outline-variant pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-2 text-body-sm text-on-surface-variant hover:text-primary"
          aria-expanded={showAdvanced}
        >
          <Icon name={showAdvanced ? "expand_less" : "expand_more"} className="text-[18px]" />
          Advanced — on-chain details
        </button>
        {showAdvanced && (
          <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 bg-surface-container-low rounded-lg border border-outline-variant p-6">
            {[
              { label: "Contract ID", value: onchainLeg?.contractId ?? "—" },
              { label: "TX Hash", value: onchainLeg?.txHash ?? "—" },
              { label: "Ledger", value: onchainLeg?.ledger != null ? String(onchainLeg.ledger) : "—" },
              { label: "Proof Hash", value: payment.proofHash ?? "—" },
            ].map((r) => (
              <div key={r.label}>
                <dt className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">{r.label}</dt>
                <dd className="mt-0.5 font-mono text-code-block break-all text-on-surface/80">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

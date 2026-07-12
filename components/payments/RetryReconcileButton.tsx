"use client";

import { useState, type JSX } from "react";
import { useRouter } from "next/navigation";

export function RetryReconcileButton(props: { paymentId: string; csrfToken?: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (props.csrfToken) headers["x-csrf-token"] = props.csrfToken;
      const res = await fetch(`/api/payments/${props.paymentId}/retry-reconcile`, {
        method: "POST",
        headers,
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`Retry failed (${res.status}). Try again or check the payment status.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Retry failed: network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        aria-disabled={busy}
        className="bg-surface border border-primary/20 text-primary rounded-lg font-bold px-6 py-2.5 hover:bg-primary hover:text-on-primary active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Retrying…" : "Retry Reconcile"}
      </button>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </span>
  );
}

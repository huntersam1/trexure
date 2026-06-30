"use client";

import { useState, type JSX } from "react";
import { useRouter } from "next/navigation";

export function RetryReconcileButton(props: { paymentId: string; csrfToken?: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function retry() {
    setBusy(true);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (props.csrfToken) headers["x-csrf-token"] = props.csrfToken;
      await fetch(`/api/payments/${props.paymentId}/retry-reconcile`, {
        method: "POST",
        headers,
        credentials: "same-origin",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={retry}
      disabled={busy}
      aria-disabled={busy}
      className="bg-surface border border-primary/20 text-primary rounded-lg font-bold px-6 py-2.5 hover:bg-primary hover:text-on-primary active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? "Retrying…" : "Retry Reconcile"}
    </button>
  );
}

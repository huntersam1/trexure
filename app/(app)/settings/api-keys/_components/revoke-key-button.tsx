"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RevokeKeyButton({ id, csrfToken }: { id: string; csrfToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!confirm("Revoke this API key? Programmatic access using it will stop immediately.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE", headers: { "x-csrf-token": csrfToken } });
      if (!res.ok) {
        setError(`Revoke failed (${res.status}). Try again.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Revoke failed: network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={revoke}
        disabled={busy}
        className="bg-surface border border-error/30 text-error rounded-lg px-3 py-1.5 text-body-sm hover:bg-error-container active:scale-95 transition-all disabled:opacity-50"
      >
        {busy ? "Revoking…" : "Revoke"}
      </button>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </span>
  );
}

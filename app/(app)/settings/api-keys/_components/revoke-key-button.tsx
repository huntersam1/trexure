"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RevokeKeyButton({ id, csrfToken }: { id: string; csrfToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    if (!confirm("Revoke this API key? Programmatic access using it will stop immediately.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE", headers: { "x-csrf-token": csrfToken } });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={busy}
      className="bg-surface border border-error/30 text-error rounded-lg px-3 py-1.5 text-body-sm hover:bg-error-container active:scale-95 transition-all disabled:opacity-50"
    >
      {busy ? "Revoking…" : "Revoke"}
    </button>
  );
}

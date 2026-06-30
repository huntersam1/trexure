"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "flex-1 bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";
const primaryBtn =
  "bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

export function CreateApiKeyPanel({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) { setError("Could not create key."); return; }
      const data = (await res.json()) as { plaintext: string };
      setPlaintext(data.plaintext);
      setName("");
      // Refresh the server list WITHOUT a full reload, so the shown-once secret stays visible.
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
      <h2 className="font-geist text-headline-md text-on-surface mb-1">Create API Key</h2>
      <p className="text-body-sm text-on-surface-variant mb-6">Bearer keys for programmatic access. The secret is shown only once.</p>

      <div className="flex gap-3">
        <input className={inputCls} placeholder="Key name (e.g. CI pipeline)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className={primaryBtn} disabled={busy || name.trim().length === 0} onClick={create}>
          {busy ? "Creating…" : "Create Key"}
        </button>
      </div>
      {error && <p className="mt-3 text-body-sm text-error">{error}</p>}

      {plaintext && (
        <div className="mt-4 bg-surface-container-low border border-accent/30 rounded-lg p-4">
          <p className="text-label-mono uppercase tracking-widest font-bold text-accent mb-2">Secret — copy now, shown once</p>
          <div className="flex items-center gap-3">
            <code className="font-mono text-code-block break-all text-on-surface/80 flex-1">{plaintext}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(plaintext)}
              className="bg-surface border border-primary/20 text-primary rounded-lg px-3 py-1.5 text-body-sm hover:bg-primary hover:text-on-primary active:scale-95 transition-all"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

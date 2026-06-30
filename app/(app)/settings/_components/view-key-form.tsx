"use client";
import { useActionState } from "react";
import { saveViewKeyAction, type ActionResult } from "../../../../lib/settings/actions";

const inputCls =
  "w-full bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm font-mono focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";
const primaryBtn =
  "bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:bg-surface-container-highest disabled:text-on-surface-variant disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "block text-label-mono uppercase tracking-widest font-bold text-primary/70 mb-2";

export function ViewKeyForm({ hasViewKey, fingerprint }: { hasViewKey: boolean; fingerprint: string | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveViewKeyAction, null);

  return (
    <section className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-geist text-headline-md text-on-surface">Tenant View Key</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">
            Used server-side to decrypt shielded payloads. Stored encrypted (AES-256-GCM); never displayed after saving.
          </p>
        </div>
        {hasViewKey ? (
          <span className="flex items-center gap-2 bg-primary-container text-primary border border-primary/20 rounded-lg px-3 py-1.5 font-mono text-label-mono">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden />
            VIEW KEY ••••{fingerprint}
          </span>
        ) : (
          <span className="bg-surface-container-highest text-on-surface-variant rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
            Not set
          </span>
        )}
      </header>

      <form action={action} className="space-y-4" autoComplete="off">
        <div>
          <label htmlFor="viewKey" className={labelCls}>
            {hasViewKey ? "Replace View Key" : "Set View Key"}
          </label>
          {/* write-only: no value/defaultValue is ever bound to stored data */}
          <input
            id="viewKey"
            name="viewKey"
            type="password"
            placeholder="Paste the raw view key — write-only"
            className={inputCls}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {state && !state.ok && <p className="text-body-sm text-error">{state.error}</p>}
        {state && state.ok && <p className="text-body-sm text-primary">{state.message}</p>}
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : "Save View Key"}
        </button>
      </form>
    </section>
  );
}

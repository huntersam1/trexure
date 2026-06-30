"use client";
import { useActionState } from "react";
import { saveAnchorConfigAction, type ActionResult } from "../../../../lib/settings/actions";

const inputCls =
  "w-full bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";
const primaryBtn =
  "bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "block text-label-mono uppercase tracking-widest font-bold text-primary/70 mb-2";

export function AnchorConfigForm({ provider }: { provider: "mock-anchor" | "xendit" | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveAnchorConfigAction, null);

  return (
    <section className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
      <h2 className="font-geist text-headline-md text-on-surface mb-1">Anchor Configuration</h2>
      <p className="text-body-sm text-on-surface-variant mb-6">
        The fiat payout provider and the webhook secret used to verify inbound callbacks. The secret is encrypted at rest and write-only.
      </p>

      <form action={action} className="space-y-4" autoComplete="off">
        <div>
          <label htmlFor="provider" className={labelCls}>Provider</label>
          <select id="provider" name="provider" defaultValue={provider ?? "mock-anchor"} className={inputCls}>
            <option value="mock-anchor">mock-anchor</option>
            <option value="xendit">xendit</option>
          </select>
        </div>
        <div>
          <label htmlFor="webhookSecret" className={labelCls}>Webhook Secret</label>
          {/* write-only */}
          <input id="webhookSecret" name="webhookSecret" type="password" placeholder="Enter the HMAC callback secret" className={`${inputCls} font-mono`} autoComplete="off" spellCheck={false} />
        </div>
        {state && !state.ok && <p className="text-body-sm text-error">{state.error}</p>}
        {state && state.ok && <p className="text-body-sm text-primary">{state.message}</p>}
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : "Save Anchor Config"}
        </button>
      </form>
    </section>
  );
}

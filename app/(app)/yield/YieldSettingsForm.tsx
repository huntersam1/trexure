"use client";

import { useActionState, type JSX } from "react";
import { saveYieldConfigAction, type YieldActionResult } from "@/lib/yield/actions";

const inputCls =
  "w-full bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm font-mono focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";
const primaryBtn =
  "bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:bg-surface-container-highest disabled:text-on-surface-variant disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "block text-label-mono uppercase tracking-widest font-bold text-primary/70 mb-2";

export function YieldSettingsForm({
  enabled,
  minIdleBuffer,
  sweepThreshold,
  feeBps,
  asset,
}: {
  enabled: boolean;
  minIdleBuffer: string;
  sweepThreshold: string;
  feeBps: string;
  asset: string;
}): JSX.Element {
  const [state, action, pending] = useActionState<YieldActionResult | null, FormData>(
    saveYieldConfigAction,
    null,
  );

  return (
    <section className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
      <header className="mb-6">
        <h2 className="font-geist text-headline-md text-on-surface">Yield configuration</h2>
        <p className="text-body-sm text-on-surface-variant mt-1">
          Opt in to sweep idle balance above the buffer into {asset} between funding and disbursement.
          Liquidity is never at risk — a failed unwind falls back to the liquid buffer.
        </p>
      </header>

      <form action={action} className="space-y-5">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            className="size-4 rounded border-outline text-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="text-body-sm text-on-surface">Enable treasury yield</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
          <div>
            <label htmlFor="minIdleBuffer" className={labelCls}>
              Min idle buffer
            </label>
            <input
              id="minIdleBuffer"
              name="minIdleBuffer"
              type="text"
              inputMode="decimal"
              defaultValue={minIdleBuffer}
              className={inputCls}
            />
            <p className="mt-1 text-body-sm text-on-surface-variant/70">Kept liquid, never swept.</p>
          </div>
          <div>
            <label htmlFor="sweepThreshold" className={labelCls}>
              Sweep threshold
            </label>
            <input
              id="sweepThreshold"
              name="sweepThreshold"
              type="text"
              inputMode="decimal"
              defaultValue={sweepThreshold}
              className={inputCls}
            />
            <p className="mt-1 text-body-sm text-on-surface-variant/70">Min eligible amount to sweep.</p>
          </div>
          <div>
            <label htmlFor="feeBps" className={labelCls}>
              Platform fee (bps)
            </label>
            <input
              id="feeBps"
              name="feeBps"
              type="text"
              inputMode="numeric"
              defaultValue={feeBps}
              className={inputCls}
            />
            <p className="mt-1 text-body-sm text-on-surface-variant/70">0–10000; on yield only.</p>
          </div>
        </div>

        {state && !state.ok && (
          <p className="text-body-sm text-error" role="alert">
            {state.error}
          </p>
        )}
        {state && state.ok && <p className="text-body-sm text-primary">{state.message}</p>}

        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </section>
  );
}

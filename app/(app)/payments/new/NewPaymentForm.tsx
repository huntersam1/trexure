"use client";

import { useActionState, type JSX } from "react";
import { createPaymentAction, type CreateState } from "./actions";

const INITIAL: CreateState = { error: null };

function Field({
  id,
  label,
  children,
  error,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/70">
        {label}
      </label>
      {children}
      {error && <p className="text-body-sm text-error">{error}</p>}
    </div>
  );
}

const INPUT = "bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";

export function NewPaymentForm({ anchors }: { anchors: { id: string; label: string }[] }): JSX.Element {
  const [state, action, pending] = useActionState(createPaymentAction, INITIAL);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-5 max-w-xl">
      <Field id="recipientRef" label="Recipient Reference" error={fe.recipientRef}>
        <input id="recipientRef" name="recipientRef" required className={INPUT} placeholder="contractor_ph_0042" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="amount" label="Amount" error={fe.amount}>
          <input id="amount" name="amount" inputMode="decimal" required className={`${INPUT} font-mono`} placeholder="2500.00" />
        </Field>
        <Field id="sourceAsset" label="Source Asset" error={fe.sourceAsset}>
          <select id="sourceAsset" name="sourceAsset" defaultValue="USDC" className={INPUT}>
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field id="targetCurrency" label="Target Currency" error={fe.targetCurrency}>
          <select id="targetCurrency" name="targetCurrency" defaultValue="PHP" className={INPUT}>
            <option value="PHP">PHP</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field id="anchorId" label="Anchor" error={fe.anchorId}>
          <select id="anchorId" name="anchorId" defaultValue={anchors[0]?.id ?? ""} className={INPUT}>
            {anchors.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="memo" label="Memo (optional)" error={fe.memo}>
        <input id="memo" name="memo" className={INPUT} placeholder="June payroll" />
      </Field>

      {state.error && (
        <p role="alert" className="text-body-sm text-error bg-error-container rounded-lg px-3 py-2">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {pending ? "Submitting…" : "Submit Private Payment"}
      </button>
    </form>
  );
}

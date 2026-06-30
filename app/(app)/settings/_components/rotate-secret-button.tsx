"use client";
import { useActionState } from "react";
import { rotateWebhookSecretAction, type ActionResult } from "../../../../lib/settings/actions";

const neutralBtn =
  "bg-surface border border-outline text-on-surface rounded-lg font-bold px-6 py-2.5 hover:bg-surface-container-low active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

export function RotateSecretButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(rotateWebhookSecretAction, null);
  const revealed = state && state.ok && "revealOnce" in state ? state.revealOnce : null;

  return (
    <div className="mt-4">
      <form action={action}>
        <button type="submit" disabled={disabled || pending} className={neutralBtn}>
          {pending ? "Rotating…" : "Rotate Webhook Secret"}
        </button>
      </form>

      {state && !state.ok && <p className="mt-3 text-body-sm text-error">{state.error}</p>}
      {revealed && (
        <div className="mt-4 bg-surface-container-low border border-accent/30 rounded-lg p-4">
          <p className="text-label-mono uppercase tracking-widest font-bold text-accent mb-2">New secret — shown once</p>
          <div className="flex items-center gap-3">
            <code className="font-mono text-code-block break-all text-on-surface/80 flex-1">{revealed}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(revealed)}
              className="bg-surface border border-primary/20 text-primary rounded-lg px-3 py-1.5 text-body-sm hover:bg-primary hover:text-on-primary active:scale-95 transition-all"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

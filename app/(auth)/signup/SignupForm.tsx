"use client";

import { useActionState, type JSX } from "react";
import { signupAction, type SignupState } from "./actions";

const INITIAL: SignupState = { error: null };

const FIELDS = [
  {
    id: "tenantName",
    label: "Workspace name",
    type: "text",
    autoComplete: "organization",
    hint: "Your company or team — becomes your isolated tenant.",
  },
  {
    id: "username",
    label: "Username",
    type: "text",
    autoComplete: "username",
    hint: "3–64 chars: letters, digits, dot, dash, underscore.",
  },
  {
    id: "password",
    label: "Password",
    type: "password",
    autoComplete: "new-password",
    hint: "At least 12 characters.",
  },
] as const;

export function SignupForm(): JSX.Element {
  const [state, action, pending] = useActionState(signupAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      {FIELDS.map((f) => (
        <div key={f.id} className="flex flex-col gap-1.5">
          <label
            htmlFor={f.id}
            className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/70"
          >
            {f.label}
          </label>
          <input
            id={f.id}
            name={f.id}
            type={f.type}
            autoComplete={f.autoComplete}
            required
            aria-invalid={state.fieldErrors?.[f.id] ? true : undefined}
            className="bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
          />
          {state.fieldErrors?.[f.id] ? (
            <p className="text-body-sm text-error">{state.fieldErrors[f.id]}</p>
          ) : (
            <p className="text-body-sm text-on-surface-variant/60">{f.hint}</p>
          )}
        </div>
      ))}
      {state.error && (
        <p role="alert" className="text-body-sm text-error bg-error-container rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {pending ? "Creating your workspace…" : "Create workspace"}
      </button>
    </form>
  );
}

"use client";

import { useActionState, useState, type JSX } from "react";

import { receiverAuthAction, type ReceiverAuthState } from "./actions";

const INITIAL: ReceiverAuthState = { error: null };

const inputCls =
  "bg-surface border border-outline rounded-lg px-4 py-2.5 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none";
const labelCls = "text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/70";

export function ReceiverAuthForm(): JSX.Element {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [state, action, pending] = useActionState(receiverAuthAction, INITIAL);
  const registering = mode === "register";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="intent" value={mode} />

      <div className="flex rounded-lg border border-outline-variant p-1 text-body-sm">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-md py-1.5 font-medium ${!registering ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`flex-1 rounded-md py-1.5 font-medium ${registering ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}
        >
          Create account
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={labelCls}>
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={labelCls}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={registering ? "new-password" : "current-password"}
          required
          minLength={registering ? 12 : undefined}
          className={inputCls}
        />
        {registering && (
          <span className="text-body-sm text-on-surface-variant">At least 12 characters.</span>
        )}
      </div>

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
        {pending ? "Please wait…" : registering ? "Create account" : "Log in"}
      </button>
    </form>
  );
}

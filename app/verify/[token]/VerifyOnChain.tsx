"use client";

import { useState, type JSX } from "react";

type Result = { verified: boolean; explorerUrl: string; contractId: string };
type State = { phase: "idle" | "loading" | "done" | "error"; result?: Result; message?: string };

/**
 * Public "Verify on-chain" button (#128). Calls the token-scoped verify endpoint,
 * which re-generates and checks a real Groth16 proof against Soroban testnet. No
 * session or CSRF — the URL token is the credential and the route is rate-limited.
 */
export function VerifyOnChain({ token }: { token: string }): JSX.Element {
  const [state, setState] = useState<State>({ phase: "idle" });

  async function run(): Promise<void> {
    setState({ phase: "loading" });
    try {
      const res = await fetch(`/api/verify/${encodeURIComponent(token)}`, { method: "POST" });
      if (!res.ok) {
        const retry = res.status === 429 ? " Please wait a moment and try again." : "";
        setState({ phase: "error", message: `Verification unavailable.${retry}` });
        return;
      }
      const result = (await res.json()) as Result;
      setState({ phase: "done", result });
    } catch {
      setState({ phase: "error", message: "Network error — please try again." });
    }
  }

  if (state.phase === "done" && state.result) {
    const ok = state.result.verified;
    return (
      <div
        className={`rounded-lg border p-3 ${
          ok ? "border-primary bg-primary/10 text-primary" : "border-error bg-error/10 text-error"
        }`}
      >
        <p className="font-geist text-body-md font-bold">
          {ok ? "✓ Verified on Stellar testnet" : "✗ Proof did not verify"}
        </p>
        {state.result.explorerUrl ? (
          <a
            href={state.result.explorerUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-1 inline-block text-body-sm underline"
          >
            View the verification on-chain ↗
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state.phase === "loading"}
        className="self-start rounded-lg bg-primary px-4 py-2 text-body-sm font-medium text-on-primary disabled:opacity-60"
      >
        {state.phase === "loading" ? "Verifying on-chain…" : "Verify on-chain"}
      </button>
      {state.phase === "error" ? <p className="text-body-sm text-error">{state.message}</p> : null}
    </div>
  );
}

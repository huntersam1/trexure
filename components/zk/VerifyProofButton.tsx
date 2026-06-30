"use client";

import { useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";

type VerifyResult = { verified: boolean; commitment: string; contractId: string; explorerUrl: string };

export function VerifyProofButton(props: { paymentId: string; csrfToken?: string }): JSX.Element {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function run() {
    setState("running");
    setResult(null);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (props.csrfToken) headers["x-csrf-token"] = props.csrfToken;
      const res = await fetch(`/api/payments/${props.paymentId}/verify-proof`, {
        method: "POST",
        headers,
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("verify failed");
      setResult((await res.json()) as VerifyResult);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-low p-stack-md flex flex-col gap-2">
      <div className="flex items-center justify-between gap-stack-md">
        <div className="flex flex-col">
          <span className="text-label-sm uppercase tracking-widest text-on-surface-variant/70">Zero-knowledge proof</span>
          <span className="text-body-sm text-on-surface-variant">
            Generate a Groth16 proof and verify it on the Stellar testnet.
          </span>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={state === "running"}
          className="inline-flex items-center gap-2 bg-surface border border-primary/30 text-primary rounded-lg font-bold px-4 py-2 hover:bg-primary hover:text-on-primary active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="verified_user" className="text-[18px]" />
          {state === "running" ? "Verifying on-chain…" : "Verify proof on-chain"}
        </button>
      </div>
      {state === "done" && result && (
        <div className="flex items-center gap-2 text-body-sm">
          <Icon name={result.verified ? "check_circle" : "cancel"} className={result.verified ? "text-tertiary" : "text-error"} />
          <span className={result.verified ? "text-on-surface font-medium" : "text-error font-medium"}>
            {result.verified ? "Proof verified on Stellar testnet" : "Proof did NOT verify"}
          </span>
          <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto">
            verifier contract ↗
          </a>
        </div>
      )}
      {state === "error" && <span className="text-body-sm text-error">On-chain verification failed.</span>}
    </div>
  );
}

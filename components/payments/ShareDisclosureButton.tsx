"use client";

import { useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * Mint a verifiable disclosure link (#128) for a settled payment and reveal the
 * shareable URL once. ADMIN-only action (the API enforces it); the raw token is
 * shown a single time — re-issuing rotates it and invalidates the old URL.
 */
export function ShareDisclosureButton({
  paymentId,
  csrfToken,
}: {
  paymentId: string;
  csrfToken?: string;
}): JSX.Element {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  async function mint(): Promise<void> {
    setState("running");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const res = await fetch(`/api/payments/${paymentId}/disclosure-link`, {
        method: "POST",
        headers,
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("mint failed");
      const data = (await res.json()) as { url: string };
      setUrl(data.url);
      setState("done");
    } catch {
      setState("error");
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the input is selectable as a fallback */
    }
  }

  if (state === "done") {
    return (
      <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2">
        <span className="text-label-mono uppercase tracking-widest text-primary">Shareable verification link</span>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-md border border-outline-variant bg-surface px-3 py-2 font-mono text-body-sm text-on-surface"
          />
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-md bg-primary px-3 py-2 text-body-sm font-medium text-on-primary"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span className="text-label-mono text-on-surface-variant/70">
          Anyone with this link can view and verify this one payment until it expires or is revoked. Shown once —
          re-issuing rotates the link.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={mint}
        disabled={state === "running"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary disabled:opacity-60"
      >
        <Icon name="share" className="text-[18px]" />
        {state === "running" ? "Creating link…" : "Share verifiable link"}
      </button>
      {state === "error" ? <span className="text-body-sm text-error">Could not create link.</span> : null}
    </div>
  );
}

"use client";

import { useCallback, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { BEAT_PACING } from "../../lib/demo/replay";

export type DemoBeat = "idle" | "reset" | "shield" | "decrypt" | "reconcile" | "receipt" | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function DemoReplayController(props: {
  paymentId: string;
  intentId: string;
  amount: string;
  currency: string;
  recipientRef: string;
  csrfToken?: string;
  onBeatChange?: (beat: DemoBeat) => void;
}): JSX.Element {
  const { paymentId, intentId, amount, currency, recipientRef, csrfToken, onBeatChange } = props;
  const router = useRouter();
  const [beat, setBeat] = useState<DemoBeat>("idle");
  const [running, setRunning] = useState(false);

  const setStage = useCallback(
    (b: DemoBeat) => {
      setBeat(b);
      onBeatChange?.(b);
    },
    [onBeatChange],
  );

  // The real double-submit token comes from the page (it reads the __Host-trexure_csrf
  // cookie set at login and passes it down). assertCsrf compares header === cookie.
  const postJson = useCallback(
    async (url: string, body?: unknown): Promise<Response> => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
      return res;
    },
    [csrfToken],
  );

  const pollUntilSettled = useCallback(async (): Promise<void> => {
    const deadline = Date.now() + BEAT_PACING.pollTimeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`/api/payments/${paymentId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await res.json()) as { status?: string; receipt?: unknown };
      if (data.status === "SETTLED" && data.receipt) return;
      if (data.status === "FAILED") throw new Error("payment FAILED during replay");
      await sleep(BEAT_PACING.pollIntervalMs);
    }
    throw new Error("timed out waiting for SETTLED");
  }, [paymentId]);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      // Beat 0 — idempotent reset so replay can repeat.
      setStage("reset");
      await postJson(`/api/payments/${paymentId}/demo-reset`);
      router.refresh();
      await sleep(BEAT_PACING.beatGapMs);

      // Beat 1 — Public Ledger View (shielded). Already rendered; just hold the stage.
      setStage("shield");
      await sleep(BEAT_PACING.decryptRevealMs);

      // Beat 2 — Apply View Key (server-side decrypt).
      setStage("decrypt");
      await postJson(`/api/payments/${paymentId}/decrypt`);
      router.refresh();
      await sleep(BEAT_PACING.decryptRevealMs);

      // Beat 3 — Trigger payout with a VISIBLE delay, then watch reconcile.
      setStage("reconcile");
      await postJson(`/api/mock-anchor/payout`, {
        intentId,
        amount,
        currency,
        recipientRef,
        delayMs: BEAT_PACING.payoutDelayMs,
      });
      await pollUntilSettled();
      router.refresh();

      // Beat 4 — Receipt revealed.
      setStage("receipt");
    } catch {
      setStage("error");
    } finally {
      setRunning(false);
    }
  }, [running, paymentId, intentId, amount, currency, recipientRef, pollUntilSettled, postJson, router, setStage]);

  return (
    <button
      type="button"
      onClick={run}
      disabled={running}
      aria-disabled={running}
      data-beat={beat}
      className="inline-flex items-center gap-2 bg-accent text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-accent/20 hover:opacity-90 active:scale-95 transition-all disabled:bg-surface-container-highest disabled:text-on-surface-variant disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {running ? `Replaying… (${beat})` : "Demo Replay"}
    </button>
  );
}

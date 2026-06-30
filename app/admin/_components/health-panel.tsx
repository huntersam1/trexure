"use client";
import { useEffect, useState } from "react";

// Matches the real /api/health (Phase 5) response shape.
type Health = {
  status: "ok" | "degraded";
  checks: { db: boolean; redis: boolean; worker: boolean };
  worker: { lastBeatMs: number | null };
};

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-primary" : "bg-error"}`} aria-hidden />;
}

export function HealthPanel() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as Health;
        if (active) { setH(data); setErr(false); }
      } catch {
        if (active) setErr(true);
      }
    }
    poll();
    const t = setInterval(poll, 10_000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const row = "flex items-center justify-between py-2 border-b border-outline-variant last:border-0";
  const label = "text-body-sm text-on-surface-variant";
  const val = "flex items-center gap-2 font-mono text-label-mono";
  const lastBeat = h?.worker.lastBeatMs ? new Date(h.worker.lastBeatMs).toISOString() : "—";

  return (
    <div className="space-y-1">
      {err && <p className="text-body-sm text-error">Health endpoint unreachable.</p>}
      <div className={row}><span className={label}>Database</span><span className={val}><Dot ok={!!h?.checks.db} />{h?.checks.db ? "UP" : "DOWN"}</span></div>
      <div className={row}><span className={label}>Redis</span><span className={val}><Dot ok={!!h?.checks.redis} />{h?.checks.redis ? "UP" : "DOWN"}</span></div>
      <div className={row}>
        <span className={label}>Worker</span>
        <span className={val}><Dot ok={!!h?.checks.worker} />{h?.checks.worker ? "ALIVE" : "STALE"}</span>
      </div>
      <div className={row}>
        <span className={label}>Last heartbeat</span>
        <span className="font-mono text-label-mono text-on-surface-variant">{lastBeat}</span>
      </div>
    </div>
  );
}

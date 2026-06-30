"use client";

import { useState, type JSX } from "react";
import { Icon } from "@/components/ui/Icon";

export function DemoReplayButton(): JSX.Element {
  const [note, setNote] = useState<string | null>(null);
  // Placeholder: the 4-beat orchestration (decrypt -> payout -> poll -> receipt)
  // is implemented in Phase 9 (0100-demo-replay-export-deploy). This wires the button only.
  function onReplay() {
    setNote("Demo Replay orchestration ships in Phase 9.");
    setTimeout(() => setNote(null), 2500);
  }
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onReplay}
        className="inline-flex items-center gap-2 bg-accent text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-accent/20 hover:opacity-90 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Icon name="play_circle" className="text-[18px]" />
        Demo Replay
      </button>
      {note && <span className="text-body-sm text-on-surface-variant">{note}</span>}
    </div>
  );
}

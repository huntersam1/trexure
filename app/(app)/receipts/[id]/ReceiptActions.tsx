"use client";

import { useState, type JSX } from "react";
import { ReceiptPanel } from "@/components/ReceiptPanel";
import type { Receipt } from "@/lib/ui/types";

export function ReceiptActions({ receipt }: { receipt: Receipt }): JSX.Element {
  const [note, setNote] = useState<string | null>(null);
  // PDF export ships in Phase 9 (0100). The button is wired; the handler is a placeholder.
  function onExport() {
    setNote("PDF export ships in Phase 9.");
    setTimeout(() => setNote(null), 2500);
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <ReceiptPanel receipt={receipt} onExport={onExport} />
      {note && <span className="text-body-sm text-on-surface-variant">{note}</span>}
    </div>
  );
}

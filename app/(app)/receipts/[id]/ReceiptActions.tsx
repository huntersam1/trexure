"use client";

import { useState, type JSX } from "react";
import { ReceiptPanel } from "@/components/ReceiptPanel";
import type { Receipt } from "@/lib/ui/types";

export function ReceiptActions({ receipt, csrfToken }: { receipt: Receipt; csrfToken: string }): JSX.Element {
  const [note, setNote] = useState<string | null>(null);

  // Real PDF export: server renders the §6.4 receipt → S3 → signed URL, opened here.
  async function onExport() {
    setNote("Exporting…");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const res = await fetch(`/api/payments/${receipt.paymentId}/receipt/pdf`, {
        method: "POST",
        headers,
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("export failed");
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
      setNote(null);
    } catch {
      setNote("Export failed.");
      setTimeout(() => setNote(null), 2500);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <ReceiptPanel receipt={receipt} onExport={onExport} />
      {note && <span className="text-body-sm text-on-surface-variant">{note}</span>}
    </div>
  );
}

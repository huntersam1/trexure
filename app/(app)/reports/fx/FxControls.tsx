"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";
import type { Route } from "next";
import { Icon } from "@/components/ui/Icon";

/**
 * Period picker + export controls for the FX summary. Applying a range navigates
 * (refreshing the server-rendered preview); CSV/PDF are plain download links to
 * the ADMIN-gated report API.
 */
export function FxControls({ from, to }: { from: string; to: string }): JSX.Element {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  const query = `from=${fromDate}&to=${toDate}`;
  const base = "/api/reports/fx";

  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5 flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">From</span>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg border border-outline-variant bg-background px-3 py-2 text-body-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">To</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg border border-outline-variant bg-background px-3 py-2 text-body-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </label>

      <button
        type="button"
        onClick={() => router.push(`/reports/fx?${query}` as Route)}
        className="rounded-lg bg-primary px-5 py-2 text-body-sm font-bold text-on-primary hover:opacity-90 active:scale-95 transition-all"
      >
        Apply
      </button>

      <div className="ml-auto flex items-center gap-2">
        <a
          href={`${base}?${query}&format=csv`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
        >
          <Icon name="table" className="text-[18px]" />
          CSV
        </a>
        <a
          href={`${base}?${query}&format=pdf`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
        >
          <Icon name="picture_as_pdf" className="text-[18px]" />
          PDF
        </a>
      </div>
    </div>
  );
}

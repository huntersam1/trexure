"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";
import type { Route } from "next";
import { Icon } from "@/components/ui/Icon";

/**
 * Period + counterparty picker and export controls for the disclosure pack.
 * Applying a scope navigates (refreshing the non-decrypting preview); the
 * PDF/CSV/JSON buttons are plain download links to the ADMIN-gated API, which is
 * where the actual view-key decryption + audit logging happen.
 */
export function DisclosureControls({
  from,
  to,
  counterparty,
}: {
  from: string;
  to: string;
  counterparty: string;
}): JSX.Element {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [cp, setCp] = useState(counterparty);

  const scopeQuery = () => {
    const p = new URLSearchParams({ from: fromDate, to: toDate });
    if (cp.trim()) p.set("counterparty", cp.trim());
    return p.toString();
  };

  const apply = () => {
    router.push(`/reports/disclosure?${scopeQuery()}` as Route);
  };

  const base = "/api/reports/disclosure";
  const dl = (format: string) => `${base}?${scopeQuery()}&format=${format}`;

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
      <label className="flex flex-col gap-1">
        <span className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">
          Counterparty (optional)
        </span>
        <input
          type="text"
          value={cp}
          placeholder="All counterparties"
          onChange={(e) => setCp(e.target.value)}
          className="rounded-lg border border-outline-variant bg-background px-3 py-2 text-body-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </label>

      <button
        type="button"
        onClick={apply}
        className="rounded-lg bg-primary px-5 py-2 text-body-sm font-bold text-on-primary hover:opacity-90 active:scale-95 transition-all"
      >
        Apply
      </button>

      <div className="ml-auto flex items-center gap-2">
        <a
          href={dl("pdf")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-body-sm font-bold text-on-primary hover:opacity-90"
        >
          <Icon name="verified" className="text-[18px]" />
          Generate pack (PDF)
        </a>
        <a
          href={dl("csv")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
        >
          <Icon name="table" className="text-[18px]" />
          CSV
        </a>
        <a
          href={dl("json")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
        >
          <Icon name="data_object" className="text-[18px]" />
          JSON
        </a>
      </div>
    </div>
  );
}

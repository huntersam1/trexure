"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { JSX } from "react";

const STATUSES = ["", "PENDING", "ONCHAIN_CONFIRMED", "RECONCILING", "SETTLED", "FAILED"] as const;

export function PaymentsFilters({ status, corridor }: { status?: string; corridor?: string }): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor"); // reset pagination on filter change
    router.push(`/payments?${next.toString()}`);
  }

  return (
    <div className="flex items-center gap-3">
      <select
        aria-label="Filter by status"
        defaultValue={status ?? ""}
        onChange={(e) => update("status", e.target.value)}
        className="bg-surface border border-outline rounded-lg px-4 py-2 text-body-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s === "" ? "All statuses" : s}</option>
        ))}
      </select>
      <input
        aria-label="Filter by corridor"
        placeholder="Corridor e.g. USD→PHP"
        defaultValue={corridor ?? ""}
        onBlur={(e) => update("corridor", e.target.value.trim())}
        className="bg-surface border border-outline rounded-lg px-4 py-2 text-body-sm font-mono focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
      />
    </div>
  );
}

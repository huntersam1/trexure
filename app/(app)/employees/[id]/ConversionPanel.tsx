"use client";

import { useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

type ConvertibleItem = {
  packageItemId: string;
  label: string;
  remaining: string;
  estimatedCash: string;
  estimatedFee: string;
};
type Conversion = {
  id: string;
  packageItemId: string;
  notionalAmount: string;
  cashValue: string;
  fee: string;
  net: string;
  currency: string;
  status: string;
};

const STATUS_TONE: Record<string, string> = {
  REQUESTED: "bg-surface-container-highest text-on-surface-variant",
  APPROVED: "bg-tertiary/20 text-tertiary",
  DISBURSED: "bg-primary/15 text-primary",
  REJECTED: "bg-error/15 text-error",
};

const field = "rounded-lg border border-outline-variant bg-surface px-3 py-1.5 text-body-sm text-on-surface w-32";

export function ConversionPanel({
  employeeId,
  items,
  conversions,
  csrfToken,
}: {
  employeeId: string;
  items: ConvertibleItem[];
  conversions: Conversion[];
  csrfToken: string;
}): JSX.Element {
  const router = useRouter();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const headers = { "content-type": "application/json", "x-csrf-token": csrfToken };

  async function call(url: string, body?: unknown, key = url): Promise<void> {
    setBusy(key);
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        credentials: "same-origin",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(b.detail ?? "Action failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-stack-md">
      <h2 className="font-geist text-headline-sm text-on-surface">Convert benefits to cash</h2>

      <div className="bg-surface border border-outline-variant rounded-xl p-5 flex flex-col gap-3">
        <h3 className="font-geist text-body-lg text-on-surface">Convertible items</h3>
        {items.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No convertible balance available.</p>
        ) : (
          items.map((it) => (
            <div key={it.packageItemId} className="flex flex-wrap items-center gap-3 border-t border-outline-variant/50 pt-3">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-on-surface">{it.label}</p>
                <p className="text-label-mono text-on-surface-variant/70">
                  {it.remaining} remaining · est. cash {it.estimatedCash} (fee {it.estimatedFee})
                </p>
              </div>
              <input
                className={field}
                placeholder="amount"
                value={amounts[it.packageItemId] ?? ""}
                onChange={(e) => setAmounts((a) => ({ ...a, [it.packageItemId]: e.target.value }))}
              />
              <button
                type="button"
                disabled={busy !== null || !amounts[it.packageItemId]}
                onClick={() =>
                  call("/api/hr/conversions", {
                    employeeId,
                    packageItemId: it.packageItemId,
                    notionalAmount: amounts[it.packageItemId],
                  }, `req-${it.packageItemId}`)
                }
                className="rounded-lg bg-primary px-4 py-1.5 text-body-sm font-medium text-on-primary disabled:opacity-60"
              >
                Convert &amp; withdraw
              </button>
            </div>
          ))
        )}
      </div>

      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-outline-variant">
          <h3 className="font-geist text-body-lg text-on-surface">Conversions</h3>
        </div>
        <div className="overflow-x-auto trx-scroll">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                <th className="px-5 py-2 font-medium">Notional</th>
                <th className="px-5 py-2 font-medium">Net cash</th>
                <th className="px-5 py-2 font-medium">Fee</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {conversions.length === 0 ? (
                <tr>
                  <td className="px-5 py-3 text-on-surface-variant" colSpan={5}>
                    No conversions yet.
                  </td>
                </tr>
              ) : (
                conversions.map((c) => (
                  <tr key={c.id} className="border-t border-outline-variant/60">
                    <td className="px-5 py-2 text-on-surface">{c.notionalAmount}</td>
                    <td className="px-5 py-2 text-on-surface">{c.net} {c.currency}</td>
                    <td className="px-5 py-2 text-on-surface-variant">{c.fee}</td>
                    <td className="px-5 py-2">
                      <span className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${STATUS_TONE[c.status] ?? ""}`}>
                        {c.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex justify-end gap-2">
                        {(c.status === "REQUESTED" || c.status === "APPROVED") && (
                          <>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => call(`/api/hr/conversions/${c.id}/approve`, undefined, `app-${c.id}`)}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
                            >
                              <Icon name="payments" className="text-[15px]" /> Approve &amp; pay
                            </button>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => call(`/api/hr/conversions/${c.id}/reject`, undefined, `rej-${c.id}`)}
                              className="rounded-md border border-outline-variant px-2.5 py-1 text-on-surface-variant hover:text-error"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}
    </section>
  );
}

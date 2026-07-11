"use client";

import { useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

type Eligibility = {
  monthlyBase: string;
  currency: string;
  accrued: string;
  maxAdvanceable: string;
  outstanding: string;
  eligible: string;
  feePercent: string;
};
type Advance = {
  id: string;
  amount: string;
  fee: string;
  outstanding: string;
  currency: string;
  status: string;
};

const STATUS_TONE: Record<string, string> = {
  REQUESTED: "bg-surface-container-highest text-on-surface-variant",
  APPROVED: "bg-tertiary/20 text-tertiary",
  DISBURSED: "bg-secondary/20 text-secondary",
  REPAID: "bg-primary/15 text-primary",
  REJECTED: "bg-error/15 text-error",
};

const field = "rounded-lg border border-outline-variant bg-surface px-3 py-1.5 text-body-sm text-on-surface w-32";

export function AdvancePanel({
  employeeId,
  eligibility,
  advances,
  csrfToken,
}: {
  employeeId: string;
  eligibility: Eligibility;
  advances: Advance[];
  csrfToken: string;
}): JSX.Element {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const headers = { "content-type": "application/json", "x-csrf-token": csrfToken };

  async function call(url: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(url, { method: "POST", headers, credentials: "same-origin", ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((data as { detail?: string }).detail ?? "Action failed.");
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("Network error — please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const outstandingTotal = advances
    .filter((a) => a.status === "DISBURSED")
    .reduce((s, a) => s + Number(a.outstanding), 0);

  return (
    <section className="flex flex-col gap-stack-md">
      <h2 className="font-geist text-headline-sm text-on-surface">Salary advance</h2>

      <div className="bg-surface border border-outline-variant rounded-xl p-5 flex flex-col gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-body-sm">
          <div>
            <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Accrued</p>
            <p className="font-mono text-on-surface">{eligibility.accrued} {eligibility.currency}</p>
          </div>
          <div>
            <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Eligible now</p>
            <p className="font-mono text-primary">{eligibility.eligible} {eligibility.currency}</p>
          </div>
          <div>
            <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Outstanding</p>
            <p className="font-mono text-on-surface">{eligibility.outstanding} {eligibility.currency}</p>
          </div>
          <div>
            <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">Fee</p>
            <p className="font-mono text-on-surface-variant">{eligibility.feePercent}%</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant/50 pt-3">
          <input className={field} placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button
            type="button"
            disabled={busy || !amount}
            onClick={async () => {
              if (await call("/api/hr/advances", { employeeId, amount })) setAmount("");
            }}
            className="rounded-lg bg-primary px-4 py-1.5 text-body-sm font-medium text-on-primary disabled:opacity-60"
          >
            Request advance
          </button>
          <div className="ml-auto flex items-center gap-2">
            {outstandingTotal > 0 && (
              <span className="text-label-mono text-on-surface-variant">nets {outstandingTotal} on payout</span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const r = await call(`/api/hr/employees/${employeeId}/pay-salary`);
                if (r) {
                  const p = r.payout as { net?: string; deduction?: string } | undefined;
                  setNote(`Salary paid: net ${p?.net ?? "?"}, advances repaid ${r.repaid ?? "0"}.`);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-1.5 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary disabled:opacity-60"
            >
              <Icon name="payments" className="text-[18px]" /> Run salary payout
            </button>
          </div>
        </div>
        {note && <p className="text-body-sm text-primary">{note}</p>}
      </div>

      <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-outline-variant">
          <h3 className="font-geist text-body-lg text-on-surface">Advances</h3>
        </div>
        <div className="overflow-x-auto trx-scroll">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                <th className="px-5 py-2 font-medium">Amount</th>
                <th className="px-5 py-2 font-medium">Fee</th>
                <th className="px-5 py-2 font-medium">Outstanding</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {advances.length === 0 ? (
                <tr>
                  <td className="px-5 py-3 text-on-surface-variant" colSpan={5}>No advances yet.</td>
                </tr>
              ) : (
                advances.map((a) => (
                  <tr key={a.id} className="border-t border-outline-variant/60">
                    <td className="px-5 py-2 text-on-surface">{a.amount} {a.currency}</td>
                    <td className="px-5 py-2 text-on-surface-variant">{a.fee}</td>
                    <td className="px-5 py-2 text-on-surface">{a.outstanding}</td>
                    <td className="px-5 py-2">
                      <span className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${STATUS_TONE[a.status] ?? ""}`}>
                        {a.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex justify-end gap-2">
                        {(a.status === "REQUESTED" || a.status === "APPROVED") && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => call(`/api/hr/advances/${a.id}/approve`)}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
                            >
                              <Icon name="payments" className="text-[15px]" /> Approve &amp; pay
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => call(`/api/hr/advances/${a.id}/reject`)}
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

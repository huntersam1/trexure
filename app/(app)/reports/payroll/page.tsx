import "server-only";
import type { JSX } from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { parseDateRange, toDateInput, rangeLabel } from "@/lib/reports/scope";
import { buildPayrollRegister } from "@/lib/reports/payroll";
import { buildPayrollFlow } from "@/lib/reports/payroll-flow";
import { PayrollFlowMap } from "@/components/reports/PayrollFlowMap";
import { Icon } from "@/components/ui/Icon";
import { PayrollControls } from "./PayrollControls";

export const dynamic = "force-dynamic";

const CLAIM_TONE: Record<string, string> = {
  claimed: "bg-primary/15 text-primary",
  unclaimed: "bg-surface-container-highest text-on-surface-variant",
  failed: "bg-error/15 text-error",
};

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5">
      <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</p>
      <p className="mt-1 font-geist text-headline-md text-on-surface">{value}</p>
    </div>
  );
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ batchId?: string; from?: string; to?: string }>;
}): Promise<JSX.Element> {
  // Payroll registers are financial data — ADMIN only, matching the rest of /reports.
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const sp = await searchParams;
  const batchId = sp.batchId?.trim() || null;
  const range = batchId ? null : parseDateRange(sp.from ?? null, sp.to ?? null);

  const register = await buildPayrollRegister(user.tenantId, { batchId, range });
  const flow = buildPayrollFlow(register);
  const rows = register.batches.flatMap((b) => b.rows);

  const from = range ? toDateInput(range.from) : "";
  const to = range ? toDateInput(range.to) : "";
  const scopeLabel = batchId ? `Batch ${batchId}` : range ? rangeLabel(range) : "All batches";

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <Link
          href={"/reports" as Route}
          className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-primary"
        >
          <Icon name="arrow_back" className="text-[16px]" />
          Reports
        </Link>
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">Disbursement / Payroll Register</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          Who was paid in a batch, how much, and whether each freelancer has claimed. The actionable split
          is <strong>claimed vs. unclaimed vs. failed</strong> — chase the freelancers who haven&rsquo;t
          claimed yet. Export to CSV for payroll/accounting or PDF for the register.
        </p>
      </div>

      <PayrollControls batchId={batchId ?? undefined} from={from} to={to} />

      <PayrollFlowMap flow={flow} scopedBatchId={batchId} />

      <section className="flex flex-col gap-stack-md">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-headline-sm text-on-surface">Register</h2>
          <span className="text-body-sm text-on-surface-variant">{scopeLabel}</span>
        </div>

        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
          <StatCard label="Disbursements" value={String(register.totals.disbursementCount)} />
          <StatCard label="Claimed" value={String(register.totals.claimed)} />
          <StatCard label="Unclaimed" value={String(register.totals.unclaimed)} />
          <StatCard label="Failed" value={String(register.totals.failed)} />
        </div>

        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant">
            <h3 className="font-geist text-body-lg text-on-surface">Disbursements</h3>
          </div>
          <div className="overflow-x-auto trx-scroll">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                  <th className="px-5 py-2 font-medium">Receiver</th>
                  <th className="px-5 py-2 font-medium text-right">Amount</th>
                  <th className="px-5 py-2 font-medium">Method</th>
                  <th className="px-5 py-2 font-medium">Claim</th>
                  <th className="px-5 py-2 font-medium">Destination</th>
                  <th className="px-5 py-2 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-on-surface-variant" colSpan={6}>
                      No disbursements in this scope.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.paymentId} className="border-t border-outline-variant/60">
                      <td className="px-5 py-2 text-on-surface">{r.receiver}</td>
                      <td className="px-5 py-2 text-right text-on-surface">
                        {r.sourceAmount} {r.sourceAsset}
                      </td>
                      <td className="px-5 py-2 text-on-surface-variant">
                        {r.payoutMethod ? (r.payoutMethod === "POOL_BANK" ? "bank" : "wallet") : "—"}
                      </td>
                      <td className="px-5 py-2">
                        <span className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${CLAIM_TONE[r.claimState]}`}>
                          {r.claimState}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-on-surface-variant truncate max-w-[14rem]">
                        {r.destination || "—"}
                      </td>
                      <td className="px-5 py-2 text-on-surface-variant">{r.receiptId || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

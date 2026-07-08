import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";

import type { Route } from "next";
import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { parseDateRange, toDateInput, rangeLabel } from "@/lib/reports/scope";
import { buildReconciliationStatement } from "@/lib/reports/reconciliation";
import { Icon } from "@/components/ui/Icon";
import { ReportControls } from "./ReportControls";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5">
      <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</p>
      <p className="mt-1 font-geist text-headline-md text-on-surface">{value}</p>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<JSX.Element> {
  // Reports are sensitive financial data — ADMIN only. To a non-admin the area
  // simply does not exist (404), consistent with the pool rail's gating.
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const sp = await searchParams;
  const range = parseDateRange(sp.from ?? null, sp.to ?? null);
  const statement = await buildReconciliationStatement(user.tenantId, range);

  const from = toDateInput(range.from);
  const to = toDateInput(range.to);
  const query = `from=${from}&to=${to}`;

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <h1 className="font-geist text-headline-lg text-on-surface">Reports</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          Reconciliation / settlement statement for the books — every settled payment for the period
          plus the exceptions finance chases. Export to CSV for QuickBooks/Xero or PDF for filing.
        </p>
      </div>

      <ReportControls from={from} to={to} downloadQuery={query} />

      <Link
        href={`/reports/disclosure?${query}` as Route}
        className="group flex items-center gap-4 rounded-xl border border-outline-variant bg-surface p-5 hover:border-primary/40"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-container text-on-primary-container">
          <Icon name="verified_user" className="text-[22px]" />
        </span>
        <span className="flex-1">
          <span className="block font-geist text-body-lg text-on-surface group-hover:text-primary">
            Compliance & Audit Disclosure Pack
          </span>
          <span className="block text-body-sm text-on-surface-variant">
            Selective view-key disclosure with on-chain proofs — the package you hand an auditor, the BIR,
            or AMLC.
          </span>
        </span>
        <Icon name="arrow_forward" className="text-[20px] text-on-surface-variant group-hover:text-primary" />
      </Link>

      <Link
        href={"/reports/payroll" as Route}
        className="group flex items-center gap-4 rounded-xl border border-outline-variant bg-surface p-5 hover:border-primary/40"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-container text-on-primary-container">
          <Icon name="groups" className="text-[22px]" />
        </span>
        <span className="flex-1">
          <span className="block font-geist text-body-lg text-on-surface group-hover:text-primary">
            Disbursement / Payroll Register
          </span>
          <span className="block text-body-sm text-on-surface-variant">
            Per-batch payroll — who was paid and who has claimed (claimed vs. unclaimed vs. failed).
          </span>
        </span>
        <Icon name="arrow_forward" className="text-[20px] text-on-surface-variant group-hover:text-primary" />
      </Link>

      <Link
        href={"/payments?status=SETTLED" as Route}
        className="group flex items-center gap-4 rounded-xl border border-outline-variant bg-surface p-5 hover:border-primary/40"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-container text-on-primary-container">
          <Icon name="verified" className="text-[22px]" />
        </span>
        <span className="flex-1">
          <span className="block font-geist text-body-lg text-on-surface group-hover:text-primary">
            Proof-of-Payment Attestation
          </span>
          <span className="block text-body-sm text-on-surface-variant">
            A signed, verifiable receipt for one settled payment — open a settled payment and export it.
          </span>
        </span>
        <Icon name="arrow_forward" className="text-[20px] text-on-surface-variant group-hover:text-primary" />
      </Link>

      <section className="flex flex-col gap-stack-md">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-headline-sm text-on-surface">
            Reconciliation Statement
          </h2>
          <span className="text-body-sm text-on-surface-variant">{rangeLabel(range)}</span>
        </div>

        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
          <StatCard label="Settled" value={String(statement.totals.settledCount)} />
          <StatCard label="Exceptions" value={String(statement.totals.exceptionCount)} />
          {statement.totals.destinationByCurrency.slice(0, 2).map((t) => (
            <StatCard key={t.currency} label={`Settled ${t.currency}`} value={t.total} />
          ))}
        </div>

        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant">
            <h3 className="font-geist text-body-lg text-on-surface">Settled payments</h3>
          </div>
          <div className="overflow-x-auto trx-scroll">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Counterparty</th>
                  <th className="px-5 py-2 font-medium">Corridor</th>
                  <th className="px-5 py-2 font-medium text-right">Source</th>
                  <th className="px-5 py-2 font-medium text-right">Target</th>
                  <th className="px-5 py-2 font-medium">On-chain Tx</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {statement.settled.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-on-surface-variant" colSpan={6}>
                      No settled payments in this period.
                    </td>
                  </tr>
                ) : (
                  statement.settled.map((r) => (
                    <tr key={r.paymentId} className="border-t border-outline-variant/60">
                      <td className="px-5 py-2 text-on-surface-variant">{r.date.slice(0, 10)}</td>
                      <td className="px-5 py-2 text-on-surface">{r.counterparty}</td>
                      <td className="px-5 py-2 text-on-surface-variant">{r.corridor}</td>
                      <td className="px-5 py-2 text-right text-on-surface">
                        {r.sourceAmount} {r.sourceAsset}
                      </td>
                      <td className="px-5 py-2 text-right text-on-surface">
                        {r.targetAmount ? `${r.targetAmount} ${r.targetCurrency}` : "—"}
                      </td>
                      <td className="px-5 py-2 text-on-surface-variant truncate max-w-[12rem]">
                        {r.txHash || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant">
            <h3 className="font-geist text-body-lg text-on-surface">Exceptions</h3>
          </div>
          <div className="overflow-x-auto trx-scroll">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Counterparty</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium text-right">Amount</th>
                  <th className="px-5 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {statement.exceptions.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-on-surface-variant" colSpan={5}>
                      No exceptions — everything in this period is settled.
                    </td>
                  </tr>
                ) : (
                  statement.exceptions.map((r) => (
                    <tr key={r.paymentId} className="border-t border-outline-variant/60">
                      <td className="px-5 py-2 text-on-surface-variant">{r.date.slice(0, 10)}</td>
                      <td className="px-5 py-2 text-on-surface">{r.counterparty}</td>
                      <td className="px-5 py-2 text-on-surface-variant">{r.status}</td>
                      <td className="px-5 py-2 text-right text-on-surface">{r.amount}</td>
                      <td className="px-5 py-2 text-on-surface-variant">{r.reason}</td>
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

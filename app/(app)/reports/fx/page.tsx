import "server-only";
import type { JSX } from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { parseDateRange, toDateInput, rangeLabel } from "@/lib/reports/scope";
import { buildFxSummary } from "@/lib/reports/fx";
import { Icon } from "@/components/ui/Icon";
import { FxControls } from "./FxControls";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5">
      <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</p>
      <p className="mt-1 font-geist text-headline-md text-on-surface">{value}</p>
    </div>
  );
}

function gainTone(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n) || n === 0) return "text-on-surface-variant";
  return n > 0 ? "text-primary" : "text-error";
}

export default async function FxPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<JSX.Element> {
  // Treasury/tax data — ADMIN only, matching the rest of /reports.
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const sp = await searchParams;
  const range = parseDateRange(sp.from ?? null, sp.to ?? null);
  const summary = await buildFxSummary(user.tenantId, range);

  const from = toDateInput(range.from);
  const to = toDateInput(range.to);

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
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">FX Realized Gain/Loss & Fees</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          The treasury/tax view — for each settled off-ramp, the rate it realized, the spread vs. the
          intent-time quote, and the fees, with per-corridor aggregates. Numbers read straight from the
          stored receipts. Export CSV for a spreadsheet or PDF for filing.
        </p>
      </div>

      <FxControls from={from} to={to} />

      <section className="flex flex-col gap-stack-md">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-headline-sm text-on-surface">Summary</h2>
          <span className="text-body-sm text-on-surface-variant">{rangeLabel(range)}</span>
        </div>

        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
          <StatCard label="Fiat payments" value={String(summary.paymentCount)} />
          {summary.aggregates.slice(0, 3).map((a) => (
            <StatCard key={a.corridor} label={`${a.corridor} G/L`} value={`${a.totalGainLoss} ${a.targetCurrency}`} />
          ))}
        </div>

        {summary.aggregates.length > 0 && (
          <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-outline-variant">
              <h3 className="font-geist text-body-lg text-on-surface">Aggregates by corridor</h3>
            </div>
            <div className="overflow-x-auto trx-scroll">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                    <th className="px-5 py-2 font-medium">Corridor</th>
                    <th className="px-5 py-2 font-medium text-right">Count</th>
                    <th className="px-5 py-2 font-medium text-right">Total Source</th>
                    <th className="px-5 py-2 font-medium text-right">Total Realized</th>
                    <th className="px-5 py-2 font-medium text-right">Wtd Avg Rate</th>
                    <th className="px-5 py-2 font-medium text-right">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {summary.aggregates.map((a) => (
                    <tr key={a.corridor} className="border-t border-outline-variant/60">
                      <td className="px-5 py-2 text-on-surface">{a.corridor}</td>
                      <td className="px-5 py-2 text-right text-on-surface-variant">{a.count}</td>
                      <td className="px-5 py-2 text-right text-on-surface">{a.totalSource} {a.sourceAsset}</td>
                      <td className="px-5 py-2 text-right text-on-surface">{a.totalRealizedFiat} {a.targetCurrency}</td>
                      <td className="px-5 py-2 text-right text-on-surface-variant">{a.weightedAvgRealizedRate}</td>
                      <td className={`px-5 py-2 text-right font-medium ${gainTone(a.totalGainLoss)}`}>
                        {a.totalGainLoss} {a.targetCurrency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant">
            <h3 className="font-geist text-body-lg text-on-surface">Per payment</h3>
          </div>
          <div className="overflow-x-auto trx-scroll">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Counterparty</th>
                  <th className="px-5 py-2 font-medium text-right">Source</th>
                  <th className="px-5 py-2 font-medium text-right">Realized</th>
                  <th className="px-5 py-2 font-medium text-right">Rate</th>
                  <th className="px-5 py-2 font-medium text-right">Gain/Loss</th>
                  <th className="px-5 py-2 font-medium text-right">Anchor Fee</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {summary.rows.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-on-surface-variant" colSpan={7}>
                      No fiat off-ramps settled in this period.
                    </td>
                  </tr>
                ) : (
                  summary.rows.map((r) => (
                    <tr key={r.paymentId} className="border-t border-outline-variant/60">
                      <td className="px-5 py-2 text-on-surface-variant">{r.date.slice(0, 10)}</td>
                      <td className="px-5 py-2 text-on-surface">{r.counterparty}</td>
                      <td className="px-5 py-2 text-right text-on-surface">{r.sourceAmount} {r.sourceAsset}</td>
                      <td className="px-5 py-2 text-right text-on-surface">{r.realizedAmount} {r.targetCurrency}</td>
                      <td className="px-5 py-2 text-right text-on-surface-variant">{r.realizedRate}</td>
                      <td className={`px-5 py-2 text-right font-medium ${gainTone(r.gainLoss)}`}>{r.gainLoss}</td>
                      <td className="px-5 py-2 text-right text-on-surface-variant">{r.anchorFee} {r.targetCurrency}</td>
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

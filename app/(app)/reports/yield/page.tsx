import "server-only";
import type { JSX } from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { parseDateRange, toDateInput, rangeLabel } from "@/lib/reports/scope";
import { buildYieldAttribution } from "@/lib/reports/yield-attribution";
import { Icon } from "@/components/ui/Icon";
import { YieldReportControls } from "./YieldReportControls";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5">
      <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</p>
      <p className="mt-1 font-geist text-headline-md text-on-surface">{value}</p>
    </div>
  );
}

export default async function YieldAttributionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}): Promise<JSX.Element> {
  // Financial data — ADMIN only, matching the rest of /reports.
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const sp = await searchParams;
  const range = parseDateRange(sp.from ?? null, sp.to ?? null);
  const report = await buildYieldAttribution(user.tenantId, range);

  const from = toDateInput(range.from);
  const to = toDateInput(range.to);
  const query = `from=${from}&to=${to}`;
  const firstAsset = report.totals.byAsset[0];

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
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">Yield Attribution</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          Per-position treasury yield for the period — how much idle balance was swept, the yield it
          earned, the platform management fee taken, and the net attributed to your tenant. Export to
          CSV for accounting or PDF for filing.
        </p>
      </div>

      <YieldReportControls from={from} to={to} downloadQuery={query} />

      <section className="flex flex-col gap-stack-md">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-headline-sm text-on-surface">Positions</h2>
          <span className="text-body-sm text-on-surface-variant">{rangeLabel(range)}</span>
        </div>

        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
          <StatCard label="Positions" value={String(report.totals.positionCount)} />
          <StatCard label="In yield" value={String(report.totals.activeCount)} />
          <StatCard label={firstAsset ? `Accrued ${firstAsset.asset}` : "Accrued"} value={firstAsset?.accrued ?? "0"} />
          <StatCard label={firstAsset ? `Net ${firstAsset.asset}` : "Net yield"} value={firstAsset?.netYield ?? "0"} />
        </div>

        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant">
            <h3 className="font-geist text-body-lg text-on-surface">Yield positions</h3>
          </div>
          <div className="overflow-x-auto trx-scroll">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-label-mono uppercase tracking-widest text-on-surface-variant/70">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Counterparty</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium text-right">Principal</th>
                  <th className="px-5 py-2 font-medium text-right">Accrued</th>
                  <th className="px-5 py-2 font-medium text-right">Fee</th>
                  <th className="px-5 py-2 font-medium text-right">Net</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {report.rows.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-on-surface-variant" colSpan={7}>
                      No yield positions in this period.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((r) => (
                    <tr key={r.paymentId} className="border-t border-outline-variant/60">
                      <td className="px-5 py-2 text-on-surface-variant">{r.date.slice(0, 10)}</td>
                      <td className="px-5 py-2 text-on-surface">{r.counterparty}</td>
                      <td className="px-5 py-2 text-on-surface-variant">{r.status}</td>
                      <td className="px-5 py-2 text-right text-on-surface">
                        {r.principal} {r.asset}
                      </td>
                      <td className="px-5 py-2 text-right text-on-surface">{r.accrued}</td>
                      <td className="px-5 py-2 text-right text-on-surface-variant">{r.platformFee}</td>
                      <td className="px-5 py-2 text-right text-on-surface">{r.netYield}</td>
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

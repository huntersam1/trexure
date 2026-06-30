import type { JSX } from "react";
import Link from "next/link";
import { getDashboardKpis } from "@/lib/data/payments";
import { KpiStat } from "@/components/ui/KpiStat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DemoReplayButton } from "@/components/shell/DemoReplayButton";
import { formatCorridor, formatDate, formatMoney } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<JSX.Element> {
  const kpis = await getDashboardKpis();

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">Treasury Overview</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">Settled volume, in-flight payouts, and recent activity.</p>
        </div>
        <DemoReplayButton />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
        <KpiStat label="Volume Settled" value={`$${kpis.volumeSettled}`} icon="payments" emphasis="accent" />
        <KpiStat label="Pending Payouts" value={String(kpis.pendingCount)} icon="hourglass_top" emphasis="primary" />
        <KpiStat label="Avg Settlement" value={`${kpis.avgSettlementMins} min`} icon="speed" emphasis="neutral" />
      </div>

      <section className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 overflow-hidden">
        <header className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
          <h2 className="font-geist text-headline-md text-on-surface">Recent Payments</h2>
          <Link href="/payments" className="text-body-sm text-primary hover:underline">View all</Link>
        </header>
        <table className="w-full text-left">
          <thead>
            <tr className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Amount</th>
              <th className="px-6 py-3">Corridor</th>
              <th className="px-6 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {kpis.recent.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant">No payments yet.</td>
              </tr>
            )}
            {kpis.recent.map((p) => (
              <tr key={p.id} className="border-t border-outline-variant hover:bg-surface-container-low">
                <td className="px-6 py-4">
                  <Link href={`/payments/${p.id}`}>
                    <StatusBadge status={p.status} />
                  </Link>
                </td>
                <td className="px-6 py-4 font-mono text-body-sm">{formatMoney(p.sourceAmount, p.sourceAsset)}</td>
                <td className="px-6 py-4 font-mono text-body-sm text-on-surface-variant">{formatCorridor(p.corridorFrom, p.corridorTo)}</td>
                <td className="px-6 py-4 text-body-sm text-on-surface-variant">{formatDate(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

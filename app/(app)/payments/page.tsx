import type { JSX } from "react";
import Link from "next/link";
import { listPayments } from "@/lib/data/payments";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PaymentsFilters } from "./PaymentsFilters";
import { formatCorridor, formatDate, formatMoney } from "@/lib/ui/format";
import type { PaymentStatus } from "@/lib/ui/types";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; corridor?: string; cursor?: string }>;
}): Promise<JSX.Element> {
  const sp = await searchParams;
  const { items, nextCursor } = await listPayments({
    status: sp.status as PaymentStatus | undefined,
    corridor: sp.corridor,
    cursor: sp.cursor,
    limit: 20,
  });

  const baseParams = new URLSearchParams();
  if (sp.status) baseParams.set("status", sp.status);
  if (sp.corridor) baseParams.set("corridor", sp.corridor);

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center justify-between">
        <h1 className="font-geist text-headline-lg text-on-surface">Payments</h1>
        <div className="flex items-center gap-4">
          <PaymentsFilters status={sp.status} corridor={sp.corridor} />
          <Link
            href="/payments/new"
            className="bg-primary text-on-primary rounded-lg font-bold px-6 py-2.5 shadow-lg shadow-primary/10 hover:opacity-90 active:scale-95 transition-all"
          >
            New Payment
          </Link>
        </div>
      </div>

      <section className="bg-surface border border-outline-variant rounded-xl shadow-xl shadow-black/5 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/60">
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Amount</th>
              <th className="px-6 py-3">Corridor</th>
              <th className="px-6 py-3">Created</th>
              <th className="px-6 py-3">Settled</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-on-surface-variant">No payments match these filters.</td>
              </tr>
            )}
            {items.map((p) => (
              <tr key={p.id} className="border-t border-outline-variant hover:bg-surface-container-low">
                <td className="px-6 py-4">
                  <Link href={`/payments/${p.id}`}><StatusBadge status={p.status} /></Link>
                </td>
                <td className="px-6 py-4 font-mono text-body-sm">{formatMoney(p.sourceAmount, p.sourceAsset)}</td>
                <td className="px-6 py-4 font-mono text-body-sm text-on-surface-variant">{formatCorridor(p.corridorFrom, p.corridorTo)}</td>
                <td className="px-6 py-4 text-body-sm text-on-surface-variant">{formatDate(p.createdAt)}</td>
                <td className="px-6 py-4 text-body-sm text-on-surface-variant">{formatDate(p.settledAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {nextCursor && (
        <div className="flex justify-end">
          <Link
            href={`/payments?${new URLSearchParams({ ...Object.fromEntries(baseParams), cursor: nextCursor }).toString()}`}
            className="bg-surface border border-outline text-on-surface rounded-lg font-bold px-6 py-2.5 hover:bg-surface-container-low active:scale-95 transition-all"
          >
            Next page
          </Link>
        </div>
      )}
    </div>
  );
}

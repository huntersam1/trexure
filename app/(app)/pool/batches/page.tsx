import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { listPoolBatches } from "@/lib/pool/batch-data";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  SETTLED: "bg-primary/15 text-primary",
  FAILED: "bg-error/15 text-error",
  ONCHAIN_CONFIRMED: "bg-accent/15 text-accent",
  RECONCILING: "bg-accent/15 text-accent",
  PENDING: "bg-surface-container-highest text-on-surface-variant",
};

export default async function PoolBatchesPage(): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  const user = await requireSession();
  const batches = await listPoolBatches(user.tenantId);

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">Batch payments</h1>
          <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
            Every private batch you have sent, with a live roll-up of each disbursement from send →
            on-chain → reconcile → receipt.
          </p>
        </div>
        <Link
          href="/pool/batch"
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2.5 text-body-sm font-medium text-on-surface hover:border-primary/40 hover:text-primary"
        >
          <Icon name="add" className="text-[18px]" />
          New batch
        </Link>
      </div>

      {batches.length === 0 ? (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low px-6 py-10 text-center text-body-md text-on-surface-variant">
          No batches yet. <Link href="/pool/batch" className="text-primary hover:underline">Send your first batch</Link>.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {batches.map((b) => (
            <Link
              key={b.id}
              href={`/pool/batches/${b.id}`}
              className="flex items-center justify-between gap-4 flex-wrap rounded-xl border border-outline-variant bg-surface px-5 py-4 hover:border-primary/40"
            >
              <div className="flex flex-col gap-1">
                <span className="font-geist text-title-md text-on-surface">
                  {b.count} receiver{b.count === 1 ? "" : "s"} · {b.totalSourceAmount} XLM
                </span>
                <span className="text-body-sm text-on-surface-variant">
                  {new Date(b.createdAt).toLocaleString()} · by {b.createdByUsername}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(["SETTLED", "ONCHAIN_CONFIRMED", "RECONCILING", "PENDING", "FAILED"] as const)
                  .filter((s) => b.rollup[s] > 0)
                  .map((s) => (
                    <span key={s} className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${STATUS_TONE[s]}`}>
                      {b.rollup[s]} {s.toLowerCase().replace("_", " ")}
                    </span>
                  ))}
                <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

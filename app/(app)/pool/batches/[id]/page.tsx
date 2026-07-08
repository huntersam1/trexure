import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";

import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getPoolBatchDetail } from "@/lib/pool/batch-data";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  SETTLED: "bg-primary/15 text-primary",
  FAILED: "bg-error/15 text-error",
  ONCHAIN_CONFIRMED: "bg-accent/15 text-accent",
  RECONCILING: "bg-accent/15 text-accent",
  PENDING: "bg-surface-container-highest text-on-surface-variant",
};

export default async function PoolBatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  if (!env.ENABLE_POOL_RAIL) notFound();
  const user = await requireSession();
  const { id } = await params;
  const batch = await getPoolBatchDetail(user.tenantId, id);
  if (!batch) notFound();

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <Link href="/pool/batches" className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-primary">
          <Icon name="arrow_back" className="text-[16px]" />
          Batch payments
        </Link>
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">
          {batch.count} receiver{batch.count === 1 ? "" : "s"} · {batch.totalSourceAmount} XLM
        </h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {new Date(batch.createdAt).toLocaleString()} · by {batch.createdByUsername}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["SETTLED", "ONCHAIN_CONFIRMED", "RECONCILING", "PENDING", "FAILED"] as const)
          .filter((s) => batch.rollup[s] > 0)
          .map((s) => (
            <span key={s} className={`rounded-full px-3 py-1 text-label-mono font-bold ${STATUS_TONE[s]}`}>
              {batch.rollup[s]} {s.toLowerCase().replace("_", " ")}
            </span>
          ))}
      </div>

      <div className="flex flex-col gap-2">
        {batch.children.map((c) => (
          <Link
            key={c.id}
            href={`/pool/batches/${batch.id}/${c.id}`}
            className="flex items-center justify-between gap-4 flex-wrap rounded-xl border border-outline-variant bg-surface px-5 py-4 hover:border-primary/40"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-on-surface">{c.recipientRef}</span>
              <span className="text-body-sm text-on-surface-variant">
                {c.sourceAmount} {c.sourceAsset}
                {c.payoutMethod ? ` · ${c.payoutMethod === "POOL_BANK" ? "bank" : "wallet"}` : ""}
                {c.fiatBankRef ? ` · ${c.fiatBankRef}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {c.hasReceipt && (
                <span title="Receipt available">
                  <Icon name="receipt_long" className="text-[18px] text-primary" />
                </span>
              )}
              <span className={`rounded-full px-2.5 py-1 text-label-mono font-bold ${STATUS_TONE[c.status] ?? STATUS_TONE.PENDING}`}>
                {c.status.toLowerCase().replace("_", " ")}
              </span>
              <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

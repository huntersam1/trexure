import "server-only";
import type { JSX } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { forTenant } from "@/lib/db";
import { env } from "@/lib/env";
import { Icon } from "@/components/ui/Icon";
import { NewPaymentForm } from "./NewPaymentForm";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage(): Promise<JSX.Element> {
  const user = await requireSession();
  if (!env.ENABLE_NEW_PAYMENTS) {
    return (
      <div className="flex flex-col gap-stack-lg">
        <div>
          <h1 className="font-geist text-headline-lg text-on-surface">New Private Payment</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Initiate a ZK-shielded payout. The on-chain leg is submitted to Stellar testnet and reconciled against the fiat payout.
          </p>
        </div>
        <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5 flex flex-col items-start gap-4">
          <div className="flex items-center gap-3">
            <Icon name="construction" className="text-[28px] text-primary" />
            <h2 className="font-geist text-title-lg font-bold text-on-surface">Shielded transfer contract — in progress</h2>
          </div>
          <p className="text-body-md text-on-surface-variant max-w-prose">
            Creating brand-new shielded payments is temporarily disabled while the on-chain
            transfer contract is deployed. Everything already on-chain still works: explore the
            sample payment&apos;s full lifecycle — decrypt, payout, reconciliation, and receipt —
            with the Demo Replay on the dashboard.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-4 py-2.5 text-body-sm font-bold hover:opacity-90 transition-opacity"
          >
            <Icon name="play_circle" className="text-[20px]" />
            Open the Demo Replay
          </Link>
        </div>
      </div>
    );
  }
  const db = forTenant(user.tenantId);
  const anchorRows = await db.anchorConfig.findMany({ select: { id: true, provider: true } });
  const anchors = anchorRows.map((a) => ({ id: a.id, label: a.provider }));

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <h1 className="font-geist text-headline-lg text-on-surface">New Private Payment</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Initiate a ZK-shielded payout. The on-chain leg is submitted to Stellar testnet and reconciled against the fiat payout.
        </p>
      </div>
      <div className="bg-surface border border-outline-variant rounded-xl p-8 shadow-xl shadow-black/5">
        <NewPaymentForm anchors={anchors} />
      </div>
    </div>
  );
}

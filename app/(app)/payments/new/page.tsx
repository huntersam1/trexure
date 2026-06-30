import "server-only";
import type { JSX } from "react";
import { requireSession } from "@/lib/auth/session";
import { forTenant } from "@/lib/db";
import { NewPaymentForm } from "./NewPaymentForm";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage(): Promise<JSX.Element> {
  const user = await requireSession();
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

import "server-only";
import type { JSX } from "react";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadYieldDashboard } from "@/lib/yield/dashboard";
import { KpiStat } from "@/components/ui/KpiStat";
import { Icon } from "@/components/ui/Icon";
import { YieldSettingsForm } from "./YieldSettingsForm";

export const dynamic = "force-dynamic";

export default async function YieldPage(): Promise<JSX.Element> {
  // When yield is off it does not exist (404); it's also treasury config → ADMIN
  // only, consistent with /reports + the pool rail gating.
  if (!env.ENABLE_YIELD) notFound();
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const dash = await loadYieldDashboard(user.tenantId);

  return (
    <div className="flex flex-col gap-stack-lg">
      <div>
        <h1 className="font-geist text-headline-lg text-on-surface">Treasury Yield</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          Idle balance between funding and disbursement is swept into {dash.asset} (a yield-bearing
          dollar) and unwound at payout — the float earns instead of sitting idle. Liquidity is sacred:
          a failed unwind falls back to the liquid buffer.
        </p>
      </div>

      {!dash.config.enabled && (
        <div className="flex items-start gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 text-body-sm text-on-surface-variant">
          <Icon name="info" className="text-[18px] text-on-surface-variant mt-0.5" />
          <p>Yield is not enabled for this workspace. Configure and enable it below to start sweeping.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-3">
        <KpiStat
          label={`In yield (${dash.asset})`}
          value={dash.inYieldBalance}
          icon="savings"
          emphasis="primary"
        />
        <KpiStat label="Accrued yield" value={dash.accruedTotal} icon="trending_up" emphasis="accent" />
        <KpiStat label="Effective APY" value={`${dash.apy}%`} icon="percent" emphasis="neutral" />
      </div>

      <div className="grid grid-cols-2 gap-gutter sm:grid-cols-4">
        <SmallStat label="Active positions" value={String(dash.activePositions)} />
        <SmallStat label="Unwound" value={String(dash.unwoundCount)} />
        <SmallStat label="Buffer fallbacks" value={String(dash.failedCount)} />
        <SmallStat label="Net yield to you" value={dash.netYieldTotal} />
      </div>

      <YieldSettingsForm
        enabled={dash.config.enabled}
        minIdleBuffer={dash.config.minIdleBuffer}
        sweepThreshold={dash.config.sweepThreshold}
        feeBps={dash.config.feeBps}
        asset={dash.asset}
      />
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5">
      <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</p>
      <p className="mt-1 font-geist text-headline-md text-on-surface">{value}</p>
    </div>
  );
}

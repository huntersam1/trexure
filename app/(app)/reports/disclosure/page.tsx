import "server-only";
import type { JSX } from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { parseDateRange, toDateInput, rangeLabel } from "@/lib/reports/scope";
import { previewDisclosureScope } from "@/lib/reports/disclosure";
import { Icon } from "@/components/ui/Icon";
import { DisclosureControls } from "./DisclosureControls";

export const dynamic = "force-dynamic";

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-surface border border-outline-variant rounded-xl p-5">
      <p className="text-label-mono uppercase tracking-widest text-on-surface-variant/70">{label}</p>
      <p className="mt-1 font-geist text-headline-md text-on-surface">{value}</p>
    </div>
  );
}

export default async function DisclosurePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; counterparty?: string }>;
}): Promise<JSX.Element> {
  // Decrypting shielded payments is the most sensitive action in the app — ADMIN
  // only. To a non-admin the area does not exist (404), like the rest of /reports.
  const user = await requireSession();
  if (user.role !== "ADMIN") notFound();

  const sp = await searchParams;
  const counterparty = sp.counterparty?.trim() ?? "";
  const range = parseDateRange(sp.from ?? null, sp.to ?? null);

  // Preview reveals NOTHING shielded and writes no audit — only counts and the
  // opaque counterparty refs already stored in the clear. The reveal happens on
  // download, in the ADMIN-gated API.
  const scope = await previewDisclosureScope(user.tenantId, range, counterparty || null);

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
        <h1 className="mt-2 font-geist text-headline-lg text-on-surface">Compliance & Audit Disclosure Pack</h1>
        <p className="mt-1 text-body-md text-on-surface-variant max-w-prose">
          The report only Trexure can produce: a period (and optionally single-counterparty) package for
          your external auditor, the BIR, or AMLC. Each payment is revealed <em>only</em> by decrypting it
          under your tenant view key, with the on-chain tx + ZK proof an auditor can verify independently —
          while the public ledger stays shielded.
        </p>
      </div>

      <div className="rounded-xl border border-tertiary/50 bg-tertiary/10 p-4 flex gap-3">
        <Icon name="lock" className="text-tertiary text-[20px] shrink-0" />
        <p className="text-body-sm text-on-surface-variant">
          <span className="font-bold text-on-surface">Sensitive action.</span> Generating a pack decrypts the
          selected payments under your view key server-side and writes an audit-log entry for every reveal
          plus the pack itself. The view key never leaves the server and is zeroized after use.
        </p>
      </div>

      <DisclosureControls from={from} to={to} counterparty={counterparty} />

      <section className="flex flex-col gap-stack-md">
        <div className="flex items-center justify-between">
          <h2 className="font-geist text-headline-sm text-on-surface">Scope preview</h2>
          <span className="text-body-sm text-on-surface-variant">
            {rangeLabel(range)}
            {counterparty ? ` · ${counterparty}` : ""}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-gutter sm:grid-cols-3">
          <StatCard label="Payments in scope" value={String(scope.paymentCount)} />
          <StatCard label="Shielded (revealable)" value={String(scope.shieldedCount)} />
          <StatCard label="Counterparties" value={String(scope.counterparties.length)} />
        </div>

        <div className="bg-surface border border-outline-variant rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant">
            <h3 className="font-geist text-body-lg text-on-surface">Counterparties in scope</h3>
            <p className="text-body-sm text-on-surface-variant">
              Opaque references only — names and amounts stay shielded until you generate the pack.
            </p>
          </div>
          <div className="p-5">
            {scope.counterparties.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">No payments in this period.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 font-mono text-body-sm">
                {scope.counterparties.map((c) => (
                  <li
                    key={c}
                    className="rounded-lg border border-outline-variant px-3 py-1 text-on-surface"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

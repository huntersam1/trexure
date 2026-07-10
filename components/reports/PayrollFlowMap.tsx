"use client";

import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

import type { FlowBatch, FlowDestType, FlowGroup, PayrollFlow } from "@/lib/reports/payroll-flow";
import { connectorPath, leftAnchor, rightAnchor } from "./flow-geometry";

/**
 * Interactive flow map for the payroll register: Treasury → batch pills →
 * destination groups → receiver leaves. Nodes are plain HTML; connectors are
 * one absolutely-positioned SVG layer measured from node refs. Batches start
 * collapsed except the explicitly scoped one. The map renders only fields
 * already exported by this ADMIN-gated register — its table plus its CSV/PDF
 * exports.
 */

const DEST_META: Record<FlowDestType, { label: string; dot: string; border: string; text: string }> = {
  WALLET: { label: "On-chain wallet", dot: "bg-primary", border: "border-primary", text: "text-primary" },
  BANK: { label: "Bank / fiat off-ramp", dot: "bg-tertiary", border: "border-tertiary", text: "text-tertiary" },
  PENDING: {
    label: "Pending claim",
    dot: "bg-on-surface-variant",
    border: "border-on-surface-variant",
    text: "text-on-surface-variant",
  },
  FAILED: { label: "Failed", dot: "bg-error", border: "border-error", text: "text-error" },
};

const DEST_ORDER: FlowDestType[] = ["WALLET", "BANK", "PENDING", "FAILED"];

function totalsLabel(totals: { currency: string; total: string }[]): string {
  return totals.map((t) => `${t.total} ${t.currency}`).join(" · ");
}

function Dot({ type }: { type: FlowDestType }): JSX.Element {
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DEST_META[type].dot}`} />;
}

function Tooltip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-max max-w-xs rounded-lg border border-outline-variant bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface shadow-md group-hover:block group-focus-within:block"
    >
      {children}
    </span>
  );
}

function GroupNode({ group }: { group: FlowGroup }): JSX.Element {
  const meta = DEST_META[group.type];
  return (
    <span
      className={`relative group inline-flex flex-col rounded-full border ${meta.border} bg-surface px-4 py-1.5`}
      tabIndex={0}
    >
      <span className={`text-label-mono font-bold uppercase tracking-widest ${meta.text}`}>{meta.label}</span>
      <span className="text-label-mono text-on-surface-variant">
        {group.count} · {totalsLabel(group.totals)}
      </span>
      <Tooltip>
        {group.count} disbursement{group.count === 1 ? "" : "s"} · {totalsLabel(group.totals)}
      </Tooltip>
    </span>
  );
}

export function PayrollFlowMap({
  flow,
  scopedBatchId,
}: {
  flow: PayrollFlow;
  scopedBatchId: string | null;
}): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(scopedBatchId ? [scopedBatchId] : []),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<string[]>([]);

  const setNode = (id: string, el: HTMLElement | null): void => {
    if (el) nodesRef.current.set(id, el);
    else nodesRef.current.delete(id);
  };

  const toggle = (batchId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = (): void => {
      const origin = container.getBoundingClientRect();
      const nodes = nodesRef.current;
      const edges: [string, string][] = [];
      for (const b of flow.batches) {
        edges.push(["root", `b:${b.batchId}`]);
        if (!expanded.has(b.batchId)) continue;
        for (const g of b.groups) {
          edges.push([`b:${b.batchId}`, `g:${b.batchId}:${g.type}`]);
          for (const leaf of g.leaves) edges.push([`g:${b.batchId}:${g.type}`, `l:${leaf.paymentId}`]);
        }
      }
      setPaths(
        edges.flatMap(([fromId, toId]) => {
          const from = nodes.get(fromId);
          const to = nodes.get(toId);
          if (!from || !to) return [];
          return [
            connectorPath(
              rightAnchor(from.getBoundingClientRect(), origin),
              leftAnchor(to.getBoundingClientRect(), origin),
            ),
          ];
        }),
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [flow, expanded]);

  return (
    <section className="bg-surface border border-outline-variant rounded-xl">
      <div className="px-5 py-3 border-b border-outline-variant flex items-center justify-between">
        <h3 className="font-geist text-body-lg text-on-surface">Disbursement flow</h3>
        <div className="flex items-center gap-4">
          {DEST_ORDER.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-label-mono text-on-surface-variant">
              <Dot type={t} /> {DEST_META[t].label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto trx-scroll">
        <div ref={containerRef} data-testid="flow-tree" className="relative flex items-center gap-16 p-6 min-w-fit">
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full text-outline-variant">
            {paths.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
            ))}
          </svg>

          {/* Root */}
          <div
            ref={(el) => setNode("root", el)}
            className="relative z-[1] shrink-0 self-center rounded-full bg-primary px-6 py-3 text-center"
          >
            <p className="font-geist text-body-lg font-bold text-on-primary">Treasury</p>
            <p className="text-label-mono text-on-primary/80">
              {flow.disbursementCount} disbursement{flow.disbursementCount === 1 ? "" : "s"}
              {flow.totals.length > 0 ? ` · ${totalsLabel(flow.totals)}` : ""}
            </p>
          </div>

          {flow.batches.length === 0 ? (
            <p className="relative z-[1] text-body-sm text-on-surface-variant">
              No disbursements in this scope.
            </p>
          ) : (
            <div className="relative z-[1] flex flex-col gap-6">
              {flow.batches.map((b) => (
                <BatchRow
                  key={b.batchId}
                  batch={b}
                  expanded={expanded.has(b.batchId)}
                  onToggle={() => toggle(b.batchId)}
                  setNode={setNode}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BatchRow({
  batch,
  expanded,
  onToggle,
  setNode,
}: {
  batch: FlowBatch;
  expanded: boolean;
  onToggle: () => void;
  setNode: (id: string, el: HTMLElement | null) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-12">
      <span className="relative group inline-flex">
        <button
          type="button"
          ref={(el) => setNode(`b:${batch.batchId}`, el)}
          onClick={onToggle}
          aria-expanded={expanded}
          className={`shrink-0 rounded-full border px-4 py-2 text-left transition-colors ${
            expanded
              ? "border-primary bg-primary/10"
              : "border-outline-variant bg-surface-container-highest hover:border-primary"
          }`}
        >
          <span className="flex items-center gap-2">
            <span aria-hidden className="text-on-surface-variant">
              {expanded ? "▾" : "▸"}
            </span>
            <span className="font-mono text-body-sm text-on-surface">Batch {batch.batchId.slice(-8)}</span>
            <span className="inline-flex items-center gap-1">
              {batch.destTypes.map((t) => (
                <Dot key={t} type={t} />
              ))}
            </span>
          </span>
          <span className="block pl-5 text-label-mono text-on-surface-variant">
            {batch.count} · {totalsLabel(batch.totals)} · {batch.createdAt.slice(0, 10)}
          </span>
        </button>
        <Tooltip>
          Created {batch.createdAt.slice(0, 10)} by {batch.createdByUsername} · {batch.claimed} claimed ·{" "}
          {batch.unclaimed} unclaimed · {batch.failed} failed
        </Tooltip>
      </span>

      {expanded && (
        <div className="flex flex-col gap-4">
          {batch.groups.map((g) => (
            <div key={g.type} className="flex items-center gap-10">
              <span ref={(el) => setNode(`g:${batch.batchId}:${g.type}`, el)} className="shrink-0">
                <GroupNode group={g} />
              </span>
              <ul className="flex flex-col gap-1.5">
                {g.leaves.map((leaf) => (
                  <li key={leaf.paymentId} ref={(el) => setNode(`l:${leaf.paymentId}`, el)}>
                    <Link
                      href={leaf.href as Route}
                      className="inline-flex items-baseline gap-2 rounded-lg px-2 py-1 hover:bg-surface-container-highest"
                    >
                      <Dot type={g.type} />
                      <span
                        className="min-w-0 truncate max-w-[14rem] font-mono text-body-sm text-on-surface"
                        title={leaf.receiver}
                      >
                        {leaf.receiver}
                      </span>
                      <span className="font-mono text-body-sm text-on-surface-variant">{leaf.amount}</span>
                      <span className="font-mono text-label-mono text-on-surface-variant">{leaf.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

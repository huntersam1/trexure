import {
  sumByCurrency,
  type CurrencyTotal,
  type PayrollBatchGroup,
  type PayrollRegister,
  type PayrollRow,
} from "./payroll";

/**
 * Flow ("mind-map") model for the Disbursement / Payroll Register: Treasury →
 * batch → destination group (wallet / bank / pending / failed) → receiver leaf.
 * Derived entirely from an already-built `PayrollRegister` — no queries — so the
 * map can never disclose more than the table it sits above. Pending age is
 * computed against `register.generatedAt` to keep the model deterministic.
 */

export type FlowDestType = "WALLET" | "BANK" | "PENDING" | "FAILED";

export type FlowLeaf = {
  paymentId: string;
  batchId: string;
  receiver: string;
  amount: string; // "10 XLM"
  detail: string; // "tx abc123…" | bank ref | "unclaimed 6d" | "failed"
  href: string; // /pool/batches/[batchId]/[paymentId]
};

export type FlowGroup = {
  type: FlowDestType;
  count: number;
  totals: CurrencyTotal[];
  leaves: FlowLeaf[];
};

export type FlowBatch = {
  batchId: string;
  createdAt: string;
  createdByUsername: string;
  count: number;
  totalSourceAmount: string;
  totals: CurrencyTotal[];
  claimed: number;
  unclaimed: number;
  failed: number;
  destTypes: FlowDestType[]; // for the collapsed pill's destination dots
  groups: FlowGroup[]; // empty destination types omitted
};

export type PayrollFlow = {
  disbursementCount: number;
  totals: CurrencyTotal[];
  batches: FlowBatch[];
};

const GROUP_ORDER: FlowDestType[] = ["WALLET", "BANK", "PENDING", "FAILED"];

export function destTypeOf(row: Pick<PayrollRow, "claimState" | "payoutMethod">): FlowDestType {
  if (row.claimState === "failed") return "FAILED";
  if (row.claimState === "unclaimed") return "PENDING";
  return row.payoutMethod === "POOL_BANK" ? "BANK" : "WALLET";
}

export function pendingAgeDays(dateIso: string, generatedAtIso: string): number {
  const ms = new Date(generatedAtIso).getTime() - new Date(dateIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function shortRef(ref: string): string {
  return ref.length > 10 ? `${ref.slice(0, 8)}…` : ref;
}

function leafDetail(row: PayrollRow, type: FlowDestType, generatedAt: string): string {
  switch (type) {
    case "WALLET":
      return row.withdrawTx ? `tx ${shortRef(row.withdrawTx)}` : "on-chain wallet";
    case "BANK":
      return row.destination || "bank payout";
    case "PENDING":
      return `unclaimed ${pendingAgeDays(row.date, generatedAt)}d`;
    case "FAILED":
      return "failed";
  }
}

function flowBatchOf(b: PayrollBatchGroup, generatedAt: string): FlowBatch {
  const byType = new Map<FlowDestType, PayrollRow[]>();
  for (const r of b.rows) {
    const t = destTypeOf(r);
    byType.set(t, [...(byType.get(t) ?? []), r]);
  }

  const groups: FlowGroup[] = GROUP_ORDER.filter((t) => byType.has(t)).map((t) => {
    const rows = byType.get(t) as PayrollRow[];
    return {
      type: t,
      count: rows.length,
      totals: sumByCurrency(rows.map((r) => ({ currency: r.sourceAsset, value: r.sourceAmount }))),
      leaves: rows.map((r) => ({
        paymentId: r.paymentId,
        batchId: b.batchId,
        receiver: r.receiver,
        amount: `${r.sourceAmount} ${r.sourceAsset}`,
        detail: leafDetail(r, t, generatedAt),
        href: `/pool/batches/${b.batchId}/${r.paymentId}`,
      })),
    };
  });

  return {
    batchId: b.batchId,
    createdAt: b.createdAt,
    createdByUsername: b.createdByUsername,
    count: b.count,
    totalSourceAmount: b.totalSourceAmount,
    totals: sumByCurrency(b.rows.map((r) => ({ currency: r.sourceAsset, value: r.sourceAmount }))),
    claimed: b.claimed,
    unclaimed: b.unclaimed,
    failed: b.failed,
    destTypes: groups.map((g) => g.type),
    groups,
  };
}

export function buildPayrollFlow(register: PayrollRegister): PayrollFlow {
  return {
    disbursementCount: register.totals.disbursementCount,
    totals: register.totals.totalBySymbol,
    batches: register.batches.map((b) => flowBatchOf(b, register.generatedAt)),
  };
}

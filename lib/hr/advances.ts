import "server-only";

import { z } from "zod";

import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { AppError } from "../http/problem";

/**
 * Salary advance / earned wage access (#134). An employee draws against
 * earned-but-unpaid salary (accrued pro-rata within the current month, capped by
 * employer policy). The advance (+fee) is disbursed via the existing pool payout
 * rail, then netted out of a later salary payout — FIFO, partial/multi-cycle
 * supported — and marked repaid. Everything is tenant-scoped via `forTenant()`,
 * and status transitions are guarded compare-and-sets so concurrent calls can't
 * double-approve/double-disburse a money movement.
 */

const D = Prisma.Decimal;
const DP = 7;
const round = (d: Prisma.Decimal) => d.toDecimalPlaces(DP, Prisma.Decimal.ROUND_DOWN);

type AdvanceStatusName = "REQUESTED" | "APPROVED" | "DISBURSED" | "REPAID" | "REJECTED";
const NON_REPAID: AdvanceStatusName[] = ["REQUESTED", "APPROVED", "DISBURSED"];

const decimalString = z
  .string()
  .trim()
  .refine((v) => {
    try {
      return new D(v).gt(0);
    } catch {
      return false;
    }
  }, "must be a positive decimal");

export const advancePolicyInput = z.object({
  maxPercentAccrued: z.coerce.number().min(0).max(100),
  feePercent: z.coerce.number().min(0).max(100),
  perCycleCap: decimalString.optional(),
  autoApproveUnder: decimalString.optional(),
});

export const advanceRequestInput = z.object({
  employeeId: z.string().trim().min(1),
  amount: decimalString,
});

export type AdvancePolicyInput = z.infer<typeof advancePolicyInput>;
export type AdvanceRequestInput = z.infer<typeof advanceRequestInput>;

export type AdvancePolicyView = {
  maxPercentAccrued: string;
  feePercent: string;
  perCycleCap: string | null;
  autoApproveUnder: string | null;
};
export type EligibilityView = {
  monthlyBase: string;
  currency: string;
  accrued: string;
  maxAdvanceable: string;
  outstanding: string;
  eligible: string;
  feePercent: string;
};
export type AdvanceView = {
  id: string;
  employeeId: string;
  amount: string;
  fee: string;
  outstanding: string;
  currency: string;
  status: string;
  paymentId: string | null;
  createdAt: string;
};
export type SalaryPayoutView = {
  gross: string;
  deduction: string;
  net: string;
  currency: string;
  netted: AdvanceView[];
};

// ---- Policy --------------------------------------------------------------

export async function getAdvancePolicy(tenantId: string): Promise<AdvancePolicyView> {
  const p = await forTenant(tenantId).advancePolicy.findFirst();
  return {
    maxPercentAccrued: (p?.maxPercentAccrued ?? new D(50)).toString(),
    feePercent: (p?.feePercent ?? new D(0)).toString(),
    perCycleCap: p?.perCycleCap ? p.perCycleCap.toString() : null,
    autoApproveUnder: p?.autoApproveUnder ? p.autoApproveUnder.toString() : null,
  };
}

export async function setAdvancePolicy(tenantId: string, input: AdvancePolicyInput): Promise<AdvancePolicyView> {
  const db = forTenant(tenantId);
  const data = {
    maxPercentAccrued: input.maxPercentAccrued.toString(),
    feePercent: input.feePercent.toString(),
    perCycleCap: input.perCycleCap ?? null,
    autoApproveUnder: input.autoApproveUnder ?? null,
  };
  const existing = await db.advancePolicy.findFirst();
  if (existing) await db.advancePolicy.update({ where: { id: existing.id }, data });
  else await db.advancePolicy.create({ data: { tenantId, ...data } });
  return getAdvancePolicy(tenantId);
}

// ---- Accrual + eligibility -----------------------------------------------

/** Monthly base salary from the employee's current package (annual → /12). */
async function monthlyBase(
  db: ReturnType<typeof forTenant>,
  employeeId: string,
): Promise<{ base: Prisma.Decimal; currency: string }> {
  const item = await db.packageItem.findFirst({
    where: { type: "BASE_SALARY", package: { employeeId, supersededAt: null } },
  });
  if (!item || item.amount == null) return { base: new D(0), currency: "XLM" };
  const base = item.cadence === "ANNUAL" ? item.amount.div(12) : item.amount;
  return { base: round(base), currency: item.currency ?? "XLM" };
}

async function outstandingTotal(db: ReturnType<typeof forTenant>, employeeId: string): Promise<Prisma.Decimal> {
  const rows = await db.salaryAdvance.findMany({
    where: { employeeId, status: { in: NON_REPAID } },
    select: { outstanding: true },
  });
  return rows.reduce((a, r) => a.plus(r.outstanding), new D(0));
}

/** Pure accrual/eligibility math over already-fetched base + outstanding. */
function deriveEligibility(
  base: Prisma.Decimal,
  outstanding: Prisma.Decimal,
  policy: AdvancePolicyView,
  asOf: Date,
): { accrued: Prisma.Decimal; maxAdvanceable: Prisma.Decimal; eligible: Prisma.Decimal } {
  const day = asOf.getUTCDate();
  const daysInMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate();
  const accrued = round(base.mul(day).div(daysInMonth));
  let maxAdvanceable = round(accrued.mul(policy.maxPercentAccrued).div(100));
  if (policy.perCycleCap && maxAdvanceable.gt(policy.perCycleCap)) maxAdvanceable = new D(policy.perCycleCap);
  const eligible = D.max(new D(0), maxAdvanceable.sub(outstanding));
  return { accrued, maxAdvanceable, eligible };
}

export async function computeEligibility(
  tenantId: string,
  employeeId: string,
  asOf: Date = new Date(),
): Promise<EligibilityView> {
  const db = forTenant(tenantId);
  const policy = await getAdvancePolicy(tenantId);
  const { base, currency } = await monthlyBase(db, employeeId);
  const outstanding = await outstandingTotal(db, employeeId);
  const { accrued, maxAdvanceable, eligible } = deriveEligibility(base, outstanding, policy, asOf);

  return {
    monthlyBase: base.toString(),
    currency,
    accrued: accrued.toString(),
    maxAdvanceable: maxAdvanceable.toString(),
    outstanding: outstanding.toString(),
    eligible: eligible.toString(),
    feePercent: policy.feePercent,
  };
}

// ---- Lifecycle -----------------------------------------------------------

function view(a: {
  id: string;
  employeeId: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  currency: string;
  status: string;
  paymentId: string | null;
  createdAt: Date;
}): AdvanceView {
  return {
    id: a.id,
    employeeId: a.employeeId,
    amount: a.amount.toString(),
    fee: a.fee.toString(),
    outstanding: a.outstanding.toString(),
    currency: a.currency,
    status: a.status,
    paymentId: a.paymentId,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Request an advance within the eligible limit. Auto-approves under the policy threshold. */
export async function requestAdvance(
  tenantId: string,
  userId: string,
  input: AdvanceRequestInput,
  asOf: Date = new Date(),
): Promise<AdvanceView> {
  const db = forTenant(tenantId);
  const amount = new D(input.amount);
  const policy = await getAdvancePolicy(tenantId);
  const fee = round(amount.mul(policy.feePercent).div(100));
  const reserve = amount.plus(fee);
  const autoApprove = policy.autoApproveUnder != null && amount.lte(new D(policy.autoApproveUnder));

  // Recompute eligibility from the current aggregate and create in ONE
  // transaction, so two concurrent requests can't both pass the eligibility
  // check and commit the employee past the earned-wage cap.
  const created = await db.$transaction(async (tx) => {
    const item = await tx.packageItem.findFirst({
      where: { type: "BASE_SALARY", package: { employeeId: input.employeeId, supersededAt: null } },
    });
    const base =
      item?.amount == null ? new D(0) : round(item.cadence === "ANNUAL" ? item.amount.div(12) : item.amount);
    const currency = item?.currency ?? "XLM";
    const rows = await tx.salaryAdvance.findMany({
      where: { employeeId: input.employeeId, status: { in: NON_REPAID } },
      select: { outstanding: true },
    });
    const outstanding = rows.reduce((a, r) => a.plus(r.outstanding), new D(0));
    const { eligible } = deriveEligibility(base, outstanding, policy, asOf);
    if (amount.gt(eligible)) {
      throw new AppError(400, "Over limit", `Eligible for at most ${eligible} this cycle.`);
    }
    return tx.salaryAdvance.create({
      data: {
        tenantId,
        employeeId: input.employeeId,
        amount: amount.toString(),
        fee: fee.toString(),
        outstanding: reserve.toString(),
        currency,
        status: autoApprove ? "APPROVED" : "REQUESTED",
        approvedAt: autoApprove ? asOf : null,
        createdByUserId: userId,
      },
    });
  });
  return view(created);
}

async function requireExists(db: ReturnType<typeof forTenant>, id: string): Promise<void> {
  const existing = await db.salaryAdvance.findFirst({ where: { id } });
  if (!existing) throw new AppError(404, "Advance not found", "No such advance for this tenant.");
}

export async function approveAdvance(tenantId: string, id: string): Promise<AdvanceView> {
  const db = forTenant(tenantId);
  const { count } = await db.salaryAdvance.updateMany({
    where: { id, status: "REQUESTED" },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  if (count === 0) {
    await requireExists(db, id);
    throw new AppError(409, "Not pending", "Only a requested advance can be approved.");
  }
  return (await getAdvance(tenantId, id))!;
}

export async function markAdvanceDisbursed(tenantId: string, id: string, paymentId: string): Promise<AdvanceView> {
  const db = forTenant(tenantId);
  const { count } = await db.salaryAdvance.updateMany({
    where: { id, status: "APPROVED" },
    data: { status: "DISBURSED", paymentId, disbursedAt: new Date() },
  });
  if (count === 0) {
    await requireExists(db, id);
    throw new AppError(409, "Not approved", "Only an approved advance can be disbursed.");
  }
  return (await getAdvance(tenantId, id))!;
}

/** Reject a not-yet-disbursed advance (clears its outstanding so it stops counting against eligibility). */
export async function rejectAdvance(tenantId: string, id: string): Promise<AdvanceView> {
  const db = forTenant(tenantId);
  const { count } = await db.salaryAdvance.updateMany({
    where: { id, status: { in: ["REQUESTED", "APPROVED"] } },
    data: { status: "REJECTED", outstanding: "0" },
  });
  if (count === 0) {
    await requireExists(db, id);
    throw new AppError(409, "Cannot reject", "This advance can no longer be rejected.");
  }
  return (await getAdvance(tenantId, id))!;
}

export async function getAdvance(tenantId: string, id: string): Promise<AdvanceView | null> {
  const a = await forTenant(tenantId).salaryAdvance.findFirst({ where: { id } });
  return a ? view(a) : null;
}

export async function listAdvances(tenantId: string, employeeId?: string): Promise<AdvanceView[]> {
  const rows = await forTenant(tenantId).salaryAdvance.findMany({
    where: employeeId ? { employeeId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(view);
}

// ---- Salary payout with advance netting ----------------------------------

/** Compute a salary payout: gross (monthly base) minus outstanding advances (netted FIFO). */
export async function computeSalaryPayout(
  tenantId: string,
  employeeId: string,
): Promise<SalaryPayoutView> {
  const db = forTenant(tenantId);
  const { base, currency } = await monthlyBase(db, employeeId);
  const advances = await db.salaryAdvance.findMany({
    where: { employeeId, status: "DISBURSED", outstanding: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });
  const totalOutstanding = advances.reduce((a, r) => a.plus(r.outstanding), new D(0));
  const deduction = D.min(base, totalOutstanding);
  const net = base.sub(deduction);
  return {
    gross: base.toString(),
    deduction: deduction.toString(),
    net: net.toString(),
    currency,
    netted: advances.map(view),
  };
}

/**
 * Apply a repayment `deduction` FIFO across the employee's outstanding advances,
 * marking each REPAID as its outstanding reaches zero. Returns the total repaid.
 * Runs in one transaction so a payout can't partially settle.
 */
export async function settleAdvancesForPayout(
  tenantId: string,
  employeeId: string,
  deduction: Prisma.Decimal,
  salaryPaymentId: string,
  now: Date = new Date(),
): Promise<Prisma.Decimal> {
  const db = forTenant(tenantId);
  const advances = await db.salaryAdvance.findMany({
    where: { employeeId, status: "DISBURSED", outstanding: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });

  let remaining = deduction;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const adv of advances) {
    if (remaining.lte(0)) break;
    const applied = D.min(remaining, adv.outstanding);
    const newOutstanding = adv.outstanding.sub(applied);
    const cleared = newOutstanding.lte(0);
    ops.push(
      db.salaryAdvance.update({
        where: { id: adv.id },
        data: {
          outstanding: newOutstanding.toString(),
          ...(cleared ? { status: "REPAID", repaidAt: now, repaidByPaymentId: salaryPaymentId } : {}),
        },
      }),
    );
    remaining = remaining.sub(applied);
  }
  if (ops.length > 0) await db.$transaction(ops);
  return deduction.sub(remaining);
}

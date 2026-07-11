import "server-only";

import { z } from "zod";

import { forTenant } from "../db";
import { Prisma } from "../generated/prisma/client";
import { AppError } from "../http/problem";

/**
 * Non-monetary → cash conversion (#135). Liquidates the convertible portion of a
 * compensation package item (from #133) into a cash payout via the existing pool
 * payout rail. Valuation is deterministic (notional × employer rate, minus fee);
 * the item's remaining convertible balance (`notionalValue - convertedValue`) is
 * reserved at request time so concurrent requests can't over-convert, and the
 * reservation is released if the request is rejected. Everything is tenant-scoped
 * via `forTenant()`.
 */

const D = Prisma.Decimal;
const XLM_DP = 7;

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

export const conversionPolicyInput = z.object({
  ratePercent: z.coerce.number().min(0).max(100),
  feePercent: z.coerce.number().min(0).max(100),
  perConversionCap: decimalString.optional(),
});

export const conversionRequestInput = z.object({
  packageItemId: z.string().trim().min(1),
  notionalAmount: decimalString,
});

export type ConversionPolicyInput = z.infer<typeof conversionPolicyInput>;
export type ConversionRequestInput = z.infer<typeof conversionRequestInput>;

export type ConversionPolicyView = {
  ratePercent: string;
  feePercent: string;
  perConversionCap: string | null;
};
export type ConvertibleItemView = {
  packageItemId: string;
  label: string;
  notionalValue: string;
  converted: string;
  remaining: string;
  estimatedCash: string;
  estimatedFee: string;
};
export type ConversionView = {
  id: string;
  employeeId: string;
  packageItemId: string;
  notionalAmount: string;
  cashValue: string;
  fee: string;
  net: string;
  currency: string;
  status: string;
  paymentId: string | null;
  createdAt: string;
};

const DEFAULT_POLICY = { ratePercent: new D(100), feePercent: new D(0), perConversionCap: null as Prisma.Decimal | null };

// ---- Policy --------------------------------------------------------------

export async function getConversionPolicy(tenantId: string): Promise<ConversionPolicyView> {
  const p = await forTenant(tenantId).conversionPolicy.findFirst();
  const rate = p?.ratePercent ?? DEFAULT_POLICY.ratePercent;
  const fee = p?.feePercent ?? DEFAULT_POLICY.feePercent;
  const cap = p?.perConversionCap ?? DEFAULT_POLICY.perConversionCap;
  return { ratePercent: rate.toString(), feePercent: fee.toString(), perConversionCap: cap ? cap.toString() : null };
}

export async function setConversionPolicy(tenantId: string, input: ConversionPolicyInput): Promise<ConversionPolicyView> {
  const db = forTenant(tenantId);
  const data = {
    ratePercent: input.ratePercent.toString(),
    feePercent: input.feePercent.toString(),
    perConversionCap: input.perConversionCap ?? null,
  };
  const existing = await db.conversionPolicy.findFirst();
  if (existing) {
    await db.conversionPolicy.update({ where: { id: existing.id }, data });
  } else {
    await db.conversionPolicy.create({ data: { tenantId, ...data } });
  }
  return getConversionPolicy(tenantId);
}

// ---- Valuation (deterministic) -------------------------------------------

function policyDecimals(v: ConversionPolicyView) {
  return { rate: new D(v.ratePercent), fee: new D(v.feePercent), cap: v.perConversionCap ? new D(v.perConversionCap) : null };
}

/** Gross cash for a notional amount, and the fee deducted from it. */
export function valuation(
  notional: Prisma.Decimal,
  policy: ConversionPolicyView,
): { cashValue: Prisma.Decimal; fee: Prisma.Decimal; net: Prisma.Decimal } {
  const { rate, fee } = policyDecimals(policy);
  const cashValue = notional.mul(rate).div(100).toDecimalPlaces(XLM_DP, Prisma.Decimal.ROUND_DOWN);
  const feeAmount = cashValue.mul(fee).div(100).toDecimalPlaces(XLM_DP, Prisma.Decimal.ROUND_DOWN);
  return { cashValue, fee: feeAmount, net: cashValue.sub(feeAmount) };
}

// ---- Convertible items ---------------------------------------------------

export async function listConvertibleItems(tenantId: string, employeeId: string): Promise<ConvertibleItemView[]> {
  const policy = await getConversionPolicy(tenantId);
  const items = await forTenant(tenantId).packageItem.findMany({
    where: { convertible: true, notionalValue: { not: null }, package: { employeeId, supersededAt: null } },
    orderBy: { createdAt: "asc" },
  });
  return items
    .map((i) => {
      const notional = i.notionalValue ?? new D(0);
      const remaining = notional.sub(i.convertedValue);
      const v = valuation(remaining, policy);
      return {
        packageItemId: i.id,
        label: i.label,
        notionalValue: notional.toString(),
        converted: i.convertedValue.toString(),
        remaining: remaining.toString(),
        estimatedCash: v.cashValue.toString(),
        estimatedFee: v.fee.toString(),
      };
    })
    .filter((x) => new D(x.remaining).gt(0));
}

// ---- Conversion lifecycle -------------------------------------------------

function view(c: {
  id: string;
  employeeId: string;
  packageItemId: string;
  notionalAmount: Prisma.Decimal;
  cashValue: Prisma.Decimal;
  fee: Prisma.Decimal;
  currency: string;
  status: string;
  paymentId: string | null;
  createdAt: Date;
}): ConversionView {
  return {
    id: c.id,
    employeeId: c.employeeId,
    packageItemId: c.packageItemId,
    notionalAmount: c.notionalAmount.toString(),
    cashValue: c.cashValue.toString(),
    fee: c.fee.toString(),
    net: c.cashValue.sub(c.fee).toString(),
    currency: c.currency,
    status: c.status,
    paymentId: c.paymentId,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Request a conversion. Validates the item is convertible, belongs to the
 * employee, and has enough remaining balance; reserves the balance (increments
 * `convertedValue`) and creates the conversion in one transaction.
 */
export async function requestConversion(
  tenantId: string,
  employeeId: string,
  userId: string,
  input: ConversionRequestInput,
): Promise<ConversionView> {
  const db = forTenant(tenantId);
  const item = await db.packageItem.findFirst({
    where: { id: input.packageItemId, package: { employeeId, supersededAt: null } },
  });
  if (!item) throw new AppError(404, "Item not found", "No such convertible item for this employee.");
  if (!item.convertible || item.notionalValue == null) {
    throw new AppError(400, "Not convertible", "This package item cannot be converted to cash.");
  }

  const amount = new D(input.notionalAmount);
  const remaining = item.notionalValue.sub(item.convertedValue);
  if (amount.gt(remaining)) {
    throw new AppError(400, "Exceeds balance", `Only ${remaining.toString()} of notional value remains to convert.`);
  }

  const policy = await getConversionPolicy(tenantId);
  const { cashValue, fee, cap } = { ...valuation(amount, policy), cap: policyDecimals(policy).cap };
  if (cap && cashValue.gt(cap)) {
    throw new AppError(400, "Over cap", `Conversion exceeds the per-conversion cap of ${cap.toString()}.`);
  }

  const [, conversion] = await db.$transaction([
    db.packageItem.update({
      where: { id: item.id },
      data: { convertedValue: { increment: amount.toString() } },
    }),
    db.packageConversion.create({
      data: {
        tenantId,
        employeeId,
        packageItemId: item.id,
        notionalAmount: amount.toString(),
        cashValue: cashValue.toString(),
        fee: fee.toString(),
        currency: "XLM",
        status: "REQUESTED",
        createdByUserId: userId,
      },
    }),
  ]);
  return view(conversion);
}

async function loadConversion(db: ReturnType<typeof forTenant>, id: string) {
  const c = await db.packageConversion.findFirst({ where: { id } });
  if (!c) throw new AppError(404, "Conversion not found", "No such conversion for this tenant.");
  return c;
}

async function requireExists(db: ReturnType<typeof forTenant>, id: string): Promise<void> {
  const existing = await db.packageConversion.findFirst({ where: { id } });
  if (!existing) throw new AppError(404, "Conversion not found", "No such conversion for this tenant.");
}

export async function approveConversion(tenantId: string, id: string, _userId: string): Promise<ConversionView> {
  const db = forTenant(tenantId);
  // Atomic compare-and-set: the approve route pays out immediately after, so two
  // concurrent approvals must not both win (that would double-pay real XLM).
  const { count } = await db.packageConversion.updateMany({
    where: { id, status: "REQUESTED" },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  if (count === 0) {
    await requireExists(db, id);
    throw new AppError(409, "Not pending", "Only a requested conversion can be approved.");
  }
  return (await getConversion(tenantId, id))!;
}

/** Mark an approved conversion disbursed once the payout Payment exists. */
export async function markConversionDisbursed(tenantId: string, id: string, paymentId: string): Promise<ConversionView> {
  const db = forTenant(tenantId);
  const { count } = await db.packageConversion.updateMany({
    where: { id, status: "APPROVED" },
    data: { status: "DISBURSED", paymentId, disbursedAt: new Date() },
  });
  if (count === 0) {
    await requireExists(db, id);
    throw new AppError(409, "Not approved", "Only an approved conversion can be disbursed.");
  }
  return (await getConversion(tenantId, id))!;
}

/**
 * Reject a pending/approved conversion and release the reserved balance. The
 * status flip and the balance decrement run in one interactive transaction and
 * the decrement only happens if this call wins the flip — so two concurrent
 * rejects can't double-release the reserved balance.
 */
export async function rejectConversion(tenantId: string, id: string, _userId: string): Promise<ConversionView> {
  const db = forTenant(tenantId);
  const c = await loadConversion(db, id);
  const won = await db.$transaction(async (tx) => {
    const { count } = await tx.packageConversion.updateMany({
      where: { id, status: { in: ["REQUESTED", "APPROVED"] } },
      data: { status: "REJECTED" },
    });
    if (count === 0) return false;
    await tx.packageItem.update({
      where: { id: c.packageItemId },
      data: { convertedValue: { decrement: c.notionalAmount.toString() } },
    });
    return true;
  });
  if (!won) throw new AppError(409, "Cannot reject", "This conversion can no longer be rejected.");
  return (await getConversion(tenantId, id))!;
}

export async function getConversion(tenantId: string, id: string): Promise<ConversionView | null> {
  const c = await forTenant(tenantId).packageConversion.findFirst({ where: { id } });
  return c ? view(c) : null;
}

export async function listConversions(tenantId: string, employeeId?: string): Promise<ConversionView[]> {
  const rows = await forTenant(tenantId).packageConversion.findMany({
    where: employeeId ? { employeeId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(view);
}

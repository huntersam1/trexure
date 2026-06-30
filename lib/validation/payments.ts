import { z } from "zod";

/** A positive decimal string (kept as a string to preserve precision for Prisma Decimal). */
const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "amount must be a non-negative decimal string")
  .refine((s) => Number(s) > 0, "amount must be greater than zero");

export const PAYMENT_STATUSES = [
  "DRAFT",
  "PENDING",
  "ONCHAIN_CONFIRMED",
  "RECONCILING",
  "SETTLED",
  "FAILED",
] as const;

export const createPaymentSchema = z
  .object({
    recipientRef: z.string().min(1).max(200),
    amount: decimalString,
    sourceAsset: z.string().min(1).max(32),
    targetCurrency: z.string().min(2).max(8),
    anchorId: z.string().min(1).max(64),
    memo: z.string().max(64).optional(),
  })
  .strict();

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const listPaymentsQuerySchema = z
  .object({
    status: z.enum(PAYMENT_STATUSES).optional(),
    corridor: z.string().max(16).optional(), // e.g. "USD->PHP"
    cursor: z.string().max(64).optional(),
    // Clamp (not reject) to 100 so an over-large limit is capped rather than erroring.
    limit: z.coerce.number().int().min(1).transform((n) => Math.min(n, 100)).default(20),
  })
  .strict();

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

/** Known stablecoin -> fiat ticker mapping for corridor display. */
const STABLECOIN_FIAT: Record<string, string> = {
  USDC: "USD",
  USDT: "USD",
  EURC: "EUR",
};

/** Derive the corridor {from,to} (e.g. USDC->PHP becomes USD->PHP). */
export function corridorFor(
  sourceAsset: string,
  targetCurrency: string,
): { from: string; to: string } {
  return {
    from: STABLECOIN_FIAT[sourceAsset.toUpperCase()] ?? sourceAsset.toUpperCase(),
    to: targetCurrency.toUpperCase(),
  };
}

import { z } from "zod";

/** Positive decimal as a string — money never crosses the boundary as a JS number. */
const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

/** §8.1 Mock Anchor / Xendit event shape. `.strict()` rejects unknown keys. */
export const fiatWebhookSchema = z
  .object({
    id: z.string().min(1), // externalId → idempotency
    event: z.enum(["payment.completed", "payment.failed"]),
    intentId: z.string().min(1), // reconciliation join key
    providerRef: z.string().min(1),
    bankRef: z.string().min(1),
    amount: decimalString,
    currency: z.string().min(1),
    fxRate: decimalString,
    anchorFee: decimalString,
    createdAt: z.string().min(1),
  })
  .strict();
export type FiatWebhookEvent = z.infer<typeof fiatWebhookSchema>;

/** Optional Soroban indexer (Mercury/SubQuery) push payload. */
export const chainWebhookSchema = z
  .object({
    id: z.string().min(1),
    intentId: z.string().min(1),
    txHash: z.string().min(1),
    ledger: z.number().int().nonnegative(),
    contractId: z.string().min(1),
    proofHash: z.string().min(1),
  })
  .strict();
export type ChainWebhookEvent = z.infer<typeof chainWebhookSchema>;

/** Body for POST /api/mock-anchor/payout. */
export const mockPayoutSchema = z
  .object({
    intentId: z.string().min(1),
    amount: decimalString,
    currency: z.string().min(1),
    recipientRef: z.string().min(1),
    delayMs: z.number().int().min(0).max(60_000).optional(),
    fail: z.boolean().optional(),
  })
  .strict();
export type MockPayoutInput = z.infer<typeof mockPayoutSchema>;

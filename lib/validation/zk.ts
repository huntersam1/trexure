import { z } from "zod";

/**
 * POST /api/payments/[id]/decrypt — validates the path param. `.strict()` rejects
 * any unknown keys (no view key or extra fields may be smuggled in the body).
 */
export const decryptSchema = z
  .object({
    id: z.string().min(1, "payment id is required"),
  })
  .strict();

export type DecryptInput = z.infer<typeof decryptSchema>;

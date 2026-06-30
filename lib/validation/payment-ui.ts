import { z } from "zod";

export const loginFormSchema = z
  .object({
    username: z.string().min(1, "Username is required").max(64),
    password: z.string().min(1, "Password is required").max(256),
  })
  .strict();

export const createPaymentFormSchema = z
  .object({
    recipientRef: z.string().min(1, "Recipient is required").max(128),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/, "Amount must be a positive decimal"),
    sourceAsset: z.string().min(1).max(16),
    targetCurrency: z.string().min(3).max(8),
    anchorId: z.string().min(1, "Anchor is required"),
    memo: z.string().max(128).optional(),
  })
  .strict();

export type LoginInput = z.infer<typeof loginFormSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentFormSchema>;

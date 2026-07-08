import { z } from "zod";

/**
 * Receiver (freelancer) auth schemas (P3, #85). Registration requires a strong
 * password (same 12-char floor as tenant signup); login only checks presence so
 * the generic "invalid credentials" path never leaks policy.
 */
export const receiverRegisterSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(12, "Password must be at least 12 characters").max(256),
  })
  .strict();

export const receiverLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(1).max(256),
  })
  .strict();

export type ReceiverRegisterInput = z.infer<typeof receiverRegisterSchema>;
export type ReceiverLoginInput = z.infer<typeof receiverLoginSchema>;

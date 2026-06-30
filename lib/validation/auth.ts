import { z } from "zod";

export const loginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

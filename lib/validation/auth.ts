import { z } from "zod";

export const loginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    tenantName: z.string().trim().min(2).max(64),
    username: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, digits, dot, dash, underscore"),
    // Same policy as the admin console's createUserSchema.
    password: z.string().min(12).max(256),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

import { z } from "zod";

export const createUserSchema = z
  .object({
    username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(12).max(256),
    role: z.enum(["ADMIN", "MEMBER"]),
    // Tenant ids are cuids in general, but the seed HQ tenant uses a fixed
    // non-cuid id (`seed_tenant_trexure_hq`), so accept any non-empty id here.
    tenantId: z.string().min(1),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

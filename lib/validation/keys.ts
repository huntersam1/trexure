import { z } from "zod";

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80, "name too long"),
  })
  .strict();

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

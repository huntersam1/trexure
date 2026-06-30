import { z } from "zod";

export const viewKeySchema = z
  .object({ viewKey: z.string().min(16).max(512).trim() })
  .strict();

export const anchorConfigSchema = z
  .object({
    provider: z.enum(["mock-anchor", "xendit"]),
    webhookSecret: z.string().min(8).max(256).trim(),
  })
  .strict();

export type ViewKeyInput = z.infer<typeof viewKeySchema>;
export type AnchorConfigInput = z.infer<typeof anchorConfigSchema>;

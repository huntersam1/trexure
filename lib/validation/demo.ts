import { z } from "zod";

// demo-reset takes no body; we validate the path param shape only.
export const demoResetParamsSchema = z.object({ id: z.string().min(1) }).strict();
export type DemoResetParams = z.infer<typeof demoResetParamsSchema>;

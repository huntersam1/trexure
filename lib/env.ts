import "server-only";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Next.js loads .env for the app, but standalone entrypoints (worker, prisma
// seed, tests) need it loaded explicitly. Safe to call repeatedly.
loadDotenv();

const boolFromString = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const base64Key32 = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "MASTER_ENCRYPTION_KEY must be 32 bytes encoded as base64" },
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  SHADOW_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  SESSION_COOKIE_NAME: z.string().min(1),
  MASTER_ENCRYPTION_KEY: base64Key32,
  CSRF_SECRET: z.string().min(32),

  STELLAR_NETWORK: z.literal("testnet"),
  STELLAR_RPC_URL: z.string().url(),
  STELLAR_HORIZON_URL: z.string().url(),
  STELLAR_SOURCE_SECRET: z.string().min(1),
  ZK_CONTRACT_ID: z.string().min(1),

  ANCHOR_PROVIDER: z.enum(["mock-anchor", "xendit"]),
  ANCHOR_CALLBACK_TOKEN: z.string().min(1),
  ENABLE_MOCK_ANCHOR: boolFromString,
  // Gate for brand-new payment submission (#32). Defaults OFF so the UI never
  // exposes a flow whose on-chain leg isn't live; flip to "true" once the
  // shielded_transfer contract is deployed (#31).
  ENABLE_NEW_PAYMENTS: boolFromString.default(false),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString,
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Flatten without printing values (no secret leakage), then fail fast.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

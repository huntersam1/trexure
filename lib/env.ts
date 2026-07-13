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
  // ZK proving mode for `shield` (#46). "live" generates a REAL Groth16 proof
  // (snarkjs BLS12-381, local — no network) and stores a real-commitment
  // proofHash that verify-proof can check on-chain; "fallback" uses the labeled
  // AES-wrap path (offline/CI escape hatch) which never fakes verification.
  // Defaults to "live" so user-created payments carry a real commitment too,
  // not just the seed. Live proving needs the zk/artifacts/* (present); if they
  // are missing at runtime, `shield` catches and falls back with a clear log.
  ZK_PROVING: z.enum(["live", "fallback"]).default("live"),
  // Submit a REAL shielded_transfer testnet tx for the seeded/signup sample
  // payment's on-chain leg (#45). Defaults OFF so `docker compose up && pnpm
  // db:seed` and CI seeding work offline with a placeholder leg. Enable only
  // with a funded STELLAR_SOURCE_SECRET; if the real submit fails, the seed
  // falls back to the placeholder leg with a clear log (never hard-fails).
  SEED_ONCHAIN: boolFromString.default(false),

  ANCHOR_PROVIDER: z.enum(["mock-anchor", "xendit"]),
  // Webhook HMAC keys (#143 H1). ANCHOR_CALLBACK_TOKEN is the fallback/global
  // key; the dedicated per-provider secrets are optional. All require >= 32
  // chars so a 1-char HMAC key can't slip through.
  ANCHOR_CALLBACK_TOKEN: z.string().min(32),
  XENDIT_CALLBACK_TOKEN: z.string().min(32).optional(),
  CHAIN_WEBHOOK_SECRET: z.string().min(32).optional(),
  ENABLE_MOCK_ANCHOR: boolFromString,
  // Email delivery for batch claim links (#81). Mirrors the anchor mock|real
  // toggle: "mock" logs + records the message (CI stays offline); "resend" is a
  // NotImplemented stub until a real provider is wired. Both default so no new
  // env var is required to run/deploy.
  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  EMAIL_FROM: z.string().min(1).default("Trexure <noreply@trexure.example>"),
  // Gate for brand-new payment submission (#32). Defaults ON now that the
  // shielded_transfer contract is deployed (#31/#36) and the create→SETTLED
  // loop runs end-to-end on testnet (#40). Set "false" as a deploy-time kill
  // switch if the on-chain leg regresses.
  ENABLE_NEW_PAYMENTS: boolFromString.default(true),
  // Gate for the "Private on-chain transfer" pool rail (#65). Defaults OFF —
  // it's a separate, self-contained rail (real XLM deposit→withdraw via the
  // ShieldedPool, #59). When off, /pool routes 404 and nothing else changes.
  ENABLE_POOL_RAIL: boolFromString.default(false),
  // Deployed ShieldedPool contract (P5, #64). Defaults to the demo deployment
  // recorded in zk/pool-deploy.json; override per environment.
  POOL_CONTRACT_ID: z.string().min(1).default("CCQRSDCM7D6WQE6LJNHH5ACZ5IQRI3BTLYCLOL3UBBVEZBRMKJUPJONM"),

  // Treasury Float Yield (#161). Master gate for the yield feature — idle tenant
  // balance swept into a yield-bearing asset between funding and disbursement.
  // Defaults OFF; when off nothing sweeps and no yield surfaces (P1 foundation).
  ENABLE_YIELD: boolFromString.default(false),
  // Yield-bearing asset code (Figure's YLDS on Stellar). Per-tenant YieldConfig
  // may override; this is the platform default.
  YIELD_ASSET_CODE: z.string().min(1).default("YLDS"),

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

# Running Trexure locally

How to bring up the full stack — web app, reconciliation worker, Postgres, Redis,
and MinIO — on your machine. For deploying to Railway see
[`docs/deployment.md`](deployment.md); for the sample wallets and demo logins see the
**Sample wallets & demo accounts** section in the [README](../README.md).

**Prerequisites:** Node ≥22, pnpm ≥10 (pinned to `pnpm@10.6.4` via `packageManager`), Docker.

## 1. Clone and configure environment

```bash
cp .env.example .env
```

Fill in at minimum the **required** variables (the app fails fast via Zod validation
if these are missing):

- `DATABASE_URL`, `REDIS_URL`
- `MASTER_ENCRYPTION_KEY` (32-byte base64, AES-256-GCM)
- `CSRF_SECRET` (32+ random bytes)
- `SEED_ADMIN_PASSWORD` (used by the seed script; no default in prod)
- `STELLAR_SOURCE_SECRET` (server signing key, testnet)
- `ANCHOR_CALLBACK_TOKEN` (HMAC secret shared by the Mock Anchor and the webhook verifier)
- `APP_URL` — the canonical origin the app runs on (e.g. `http://localhost:3000` locally,
  `https://app.trexure.xyz` on staging). Mutating routes reject any request whose
  `Origin` header doesn't match this exactly, so a stale value produces a `403 —
  Request origin not allowed`.

**Optional / degrade gracefully:**

- `ZK_CONTRACT_ID` — required for on-chain proof re-verification (`verify-proof`) and
  `ZK_PROVING=live`; without it, `shield` falls back to a labeled AES-wrap path instead
  of a live Groth16 proof.
- `ANCHOR_PROVIDER` / `ENABLE_MOCK_ANCHOR` — default to `mock-anchor` / `true`; set
  `ENABLE_MOCK_ANCHOR=false` to disable the demo payout routes (they 404).
- `XENDIT_API_KEY` / `XENDIT_CALLBACK_TOKEN` — only needed when `ANCHOR_PROVIDER=xendit`.
- `S3_*` — default to the local MinIO container; point at a real S3-compatible endpoint
  for production storage.
- `SHADOW_DATABASE_URL` — used by `prisma migrate dev` locally; not needed for
  `migrate deploy` in production.

## 2. Start local infrastructure

```bash
docker compose up -d   # Postgres 17 + Redis + MinIO
```

## 3. Install dependencies

```bash
pnpm install --frozen-lockfile
```

## 4. Run migrations and seed data

```bash
pnpm db:deploy && pnpm db:seed
```

Seeds an admin user, a sample tenant, a view key, an anchor config, and one sample
shielded payment.

## 5. Run the app

```bash
pnpm dev            # web -> http://localhost:3000
pnpm worker:dev      # reconciliation worker (separate terminal)
```

Log in at `/login` with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`, or create your
own isolated workspace at **`/signup`** — self-serve signup provisions a fresh tenant
(own view key, mock-anchor config, and a sample shielded payment) so the dashboard
demos instantly without repo access or admin intervention. Use the dashboard's
**Demo Replay** button to run the full Shield → Decrypt → Reconcile → Receipt flow.

## 6. Test / lint / typecheck

```bash
pnpm test        # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm ci           # typecheck + lint + test + audit (mirrors CI)
```

## 7. ZK / demo tooling

Requires circom, snarkjs, stellar CLI, and the rustup `wasm32v1-none` target.

```bash
pnpm zk:demo          # live Groth16 proof generated + verified on Stellar testnet
pnpm demo:record      # scripted Playwright recording -> mp4
```

## Private-transfer & batch-claim demo (shielded pool)

The private on-chain rail and the freelancer **claim** flow are feature-flagged —
set `ENABLE_POOL_RAIL=true` in `.env` (default off; when off, `/pool*` and
`/claim*` return 404).

- **Payer** (tenant/admin session): shield funds and get **claimable notes**
  - `/pool` — single deposit → one `trexure-note-v1-…` note (or the one-click demo).
  - `/pool/batch` — pay many receivers at once → one note per receiver.
  - `/pool/batches` — batch overview → per-payment timeline, legs, view-key decrypt, receipt (+ PDF).
- **Receiver** (separate persona, own login at `/claim` → `/claim/login`): paste a
  note and claim to a **Stellar wallet** (settles on-chain) or a **PH bank account**
  (mock PDAX off-ramp → reconciles to a receipt). A note is a **bearer credential** —
  any holder can claim it, so deliver it privately.

Use the sample wallet addresses and demo logins from the **Sample wallets & demo
accounts** section of the [README](../README.md).

> **Pool capacity:** the demo `ShieldedPool` is a **depth-4 Merkle tree — 16
> deposits max**. When full, deposits revert with `Error(Contract, #3)`
> (`TreeFull`); redeploy a fresh pool with `stellar contract deploy` +
> `node zk/scripts/pool-init.mjs`, then update `POOL_CONTRACT_ID` (`.env` /
> `lib/env.ts`) and `zk/pool-deploy.json`.

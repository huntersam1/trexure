# Railway Deployment — Trexure

One Railway project, four services: `web`, `worker`, managed **Postgres 17**, managed **Redis**, plus a **Volume** mounted to `web`.

> **Deploying?** Follow the step-by-step, checkable [`staging-checklist.md`](staging-checklist.md) — it separates the locally-verifiable steps from the credential-gated ones. This file is the reference for *why* each piece is shaped the way it is.

## Services & config files
- `web` → `railway.web.json` (Next.js: `pnpm install --frozen-lockfile && pnpm build`, start `pnpm start`).
- `worker` → `railway.worker.json` (start `pnpm worker:prod`).
- Both build with Nixpacks pinned to Node 22 + pnpm 10 via `nixpacks.toml` (pnpm via corepack, version pinned by `package.json` `packageManager`).

> **Worker runtime note:** the worker imports `lib/` modules via the `@/*` TS path alias, which Node cannot resolve at runtime from a plain `tsc` build. So the prod worker runs through **tsx** (`worker:prod = tsx --conditions=react-server worker/index.ts`) rather than `node dist/worker/index.js`. `tsx` is a dependency and resolves the tsconfig paths + the `react-server` export condition (so `server-only` is a no-op in the standalone process).

## Release step
`web.preDeployCommand = pnpm release` runs `scripts/release.sh`:
1. `pnpm db:deploy` (= `prisma migrate deploy`, NOT `migrate dev`).
2. Guarded `pnpm db:seed` only when `RUN_SEED_ONCE=true`. Set it for the FIRST prod deploy, then delete the variable.

## Volume
Mount a Railway Volume to the `web` service at `/data`. Receipt PDF exports are written through `lib/storage` to this volume's S3-compatible gateway. The `worker` does not need the volume (PDFs are exported on demand from `web`).

## Environment variables (set on each service)
Copy every key from `.env.example`. Use Railway reference variables for managed services and internal networking:
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `SHADOW_DATABASE_URL` — only needed for `migrate dev` locally; NOT required in prod (`migrate deploy` needs no shadow DB). Leave unset in Railway.
- `REDIS_URL=${{Redis.REDIS_URL}}`
- `APP_URL=https://<web-public-domain>`
- `MASTER_ENCRYPTION_KEY`, `CSRF_SECRET`, `STELLAR_SOURCE_SECRET`, `ANCHOR_CALLBACK_TOKEN`, `ZK_CONTRACT_ID` — secrets, set per service (never in `NEXT_PUBLIC_*`).
- `ENABLE_MOCK_ANCHOR=false` on `web` in prod (the `/api/mock-anchor/*` routes return 404).
- `ENABLE_NEW_PAYMENTS=true` on **both** `web` and `worker` — this is the default now (#40), so leave it unset or set it explicitly to `true`. Set it to `false` only as a kill switch if the on-chain leg regresses; the `web` service renders the "in progress" card and `POST /api/payments` returns 503 while it's off, so `worker` and `web` should always agree.
- `ZK_CONTRACT_ID` drift caveat: the app resolves the contract from `env.ZK_CONTRACT_ID` **only** (`zk/deploy.json` is used solely by `pnpm zk:demo`). It must equal the deployed `shielded_transfer` contract — `CBCYXVZCNMQEHLN6NN375KUK2IK54PF3XUB6FMZG2J26K7A4WH2ZVTSG` (#31, per `zk/deploy.json`) — on both `web` and `worker`. A stale id reproduces the "non-existent contract function shielded_transfer" failure even though `pnpm zk:demo` passes; see `docs/zk.md`.
- `ZK_PROVING=live` on **both** `web` and `worker` — the default (#46), so user-created payments carry a real Groth16 commitment and "Verify proof on-chain" works for everyone (not just the seed). Needs the committed `zk/artifacts/*` and a funded `STELLAR_SOURCE_SECRET`; set `ZK_PROVING=fallback` only if you must run without proving artifacts/key (it never fakes verification).
- `STELLAR_NETWORK=testnet`, `STELLAR_RPC_URL`, `STELLAR_HORIZON_URL`.
- Storage: point `S3_ENDPOINT`/`S3_BUCKET`/credentials at the Railway volume gateway.

`web` and `worker` share the SAME Postgres and Redis. The `worker` should use a least-privilege DB role (AGENT §6/§10) — create a scoped role and give the `worker` its own `DATABASE_URL`.

## Internal networking
Reference services by their private domains (Railway `*.railway.internal`) so traffic stays on the internal network. In prod the anchor is real (`ENABLE_MOCK_ANCHOR=false`); the Mock Anchor (non-prod only) POSTs to `${APP_URL}/api/webhooks/fiat`.

## Blocked build domains
If a domain is blocked during build (a registry, font, or host), **surface the failure** — do not silently fall back. `pnpm install --frozen-lockfile` fails fast on a blocked registry. Read the Railway build log, identify the blocked host, and add it under the Railway project's network/allowlist settings. Never swap in a mirror or vendored copy that hides the blockage.

## Healthchecks
`web` healthcheck = `GET /api/health` (200 = DB + Redis + worker heartbeat all healthy; 503 otherwise). The `worker` has no inbound port; its health is reflected via the heartbeat in `web`'s `/api/health`.

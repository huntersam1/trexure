# Staging / Railway Deploy Readiness Checklist

A checkable runbook for standing up the Railway deployment. It complements the
prose in [`railway.md`](railway.md) — read that for the *why*; use this for the
*do it in order*. Steps are split into **automatable** (verified locally in the
staging dry-run) and **credential-gated** (need Railway access + real secrets).

The `staging` branch tracks `develop` and is the signal that a deploy is being
prepared. Keep it fast-forwarded from `develop` as PRs merge.

---

## A. Local dry-run (automatable — done before this checklist shipped)

All of these were exercised locally against the docker-compose Postgres + Redis
(a throwaway `trexure_staging_dryrun` database was created, migrated, seeded, and
dropped — the shared dev DB was left untouched):

- [x] **CI green** — `pnpm run ci` (typecheck + lint + test + `pnpm audit --audit-level=high`). ⚠️ Use `pnpm run ci`, not `pnpm ci` — pnpm reserves the bare `ci` verb for its own (unimplemented) command. GitHub Actions runs the steps individually, so CI is unaffected.
- [x] **Web build** — `pnpm build` (Next.js production build) succeeds.
- [x] **Worker boots** — `pnpm worker:prod` (`tsx --conditions=react-server worker/index.ts`) starts and emits a heartbeat. The worker runs through **tsx**, not a `node dist/…` build, because it imports `lib/` via the `@/*` path alias and needs the `react-server` export condition (so `server-only` is a no-op). Do not "fix" the start command to `node`.
- [x] **Release step** — `scripts/release.sh` (`pnpm release`) runs cleanly on a fresh DB: `prisma migrate deploy` applies the init migration, and the guarded seed runs **only** when `RUN_SEED_ONCE=true` (verified it skips otherwise).
- [x] **Health** — with web + worker up, `GET /api/health` returns `200 {"status":"ok","checks":{"db":true,"redis":true,"worker":true}}` with a fresh `worker.lastBeatMs`.

Re-run the dry-run anytime:

```bash
# fresh throwaway DB so the dev DB is untouched
docker exec trexure-postgres-1 psql -U trexure -d trexure \
  -c "DROP DATABASE IF EXISTS trexure_staging_dryrun;" -c "CREATE DATABASE trexure_staging_dryrun;"
# point DATABASE_URL/SHADOW_DATABASE_URL at it in .env, then:
pnpm install --frozen-lockfile
pnpm exec prisma generate
RUN_SEED_ONCE=true pnpm release      # migrate deploy + one-time seed
pnpm run ci && pnpm build
pnpm worker:prod &                    # boots + heartbeats
pnpm start &                          # serves on :3000
curl -s localhost:3000/api/health     # -> {"status":"ok",...}
# cleanup: kill both, DROP DATABASE trexure_staging_dryrun(_shadow)
```

---

## B. Railway project (credential-gated — needs Railway access)

One project, four services: **`web`**, **`worker`**, managed **Postgres 17**,
managed **Redis**, plus a **Volume** mounted to `web` at `/data`.

- [ ] Create the Railway project; add managed **Postgres** and **Redis** plugins.
- [ ] Add a **Volume** mounted to `web` at `/data` (receipt PDF exports).
- [ ] Create `web` service → config file `railway.web.json` (build `pnpm install --frozen-lockfile && pnpm build`, start `pnpm start`, preDeploy `pnpm release`, healthcheck `/api/health`).
- [ ] Create `worker` service → config file `railway.worker.json` (start `pnpm worker:prod`, no inbound port).
- [ ] Point both services at the **`staging`** branch (or `develop`) for auto-deploys.
- [ ] (Recommended, AGENT §6/§10) Give `worker` a least-privilege scoped DB role via its own `DATABASE_URL`.

---

## C. Service variables (credential-gated)

Set every key from [`.env.example`](../../.env.example) on **both** `web` and
`worker` unless noted. Internal-networking references keep traffic private:

**Managed-service references**
- [ ] `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- [ ] `REDIS_URL=${{Redis.REDIS_URL}}`
- [ ] `SHADOW_DATABASE_URL` — **leave unset** (only `migrate dev` needs it; `migrate deploy` does not).

**App**
- [ ] `APP_URL=https://<web-public-domain>`
- [ ] `NODE_ENV=production`
- [ ] `SESSION_COOKIE_NAME=__Host-trexure_session`

**Secrets (never in `NEXT_PUBLIC_*`)**
- [ ] `MASTER_ENCRYPTION_KEY` — 32 bytes base64.
- [ ] `CSRF_SECRET` — ≥ 32 chars.
- [ ] `ANCHOR_CALLBACK_TOKEN` — HMAC secret shared by the anchor + webhook verifier.
- [ ] `STELLAR_SOURCE_SECRET` — funded testnet signing key.
- [ ] `ZK_CONTRACT_ID` — the deployed `shielded_transfer`/verifier contract, **`CBCYXVZCNMQEHLN6NN375KUK2IK54PF3XUB6FMZG2J26K7A4WH2ZVTSG`** (per `zk/deploy.json`). ⚠️ The app resolves the contract from `env.ZK_CONTRACT_ID` **only** (`zk/deploy.json` is used solely by `pnpm zk:demo`); a stale id reproduces the "non-existent contract function shielded_transfer" failure. Must match on both `web` and `worker`.

**Stellar / storage**
- [ ] `STELLAR_NETWORK=testnet`, `STELLAR_RPC_URL`, `STELLAR_HORIZON_URL`.
- [ ] `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` / `S3_FORCE_PATH_STYLE` → Railway volume gateway.
- [ ] `ANCHOR_PROVIDER=mock-anchor`.

**Intended staging/production flag values**
- [ ] `ENABLE_MOCK_ANCHOR=false` — the `/api/mock-anchor/*` demo payout routes 404 in prod.
- [ ] `ENABLE_NEW_PAYMENTS=true` on **both** `web` and `worker` — the SPEC's primary flow ships on (default as of #40); the two services must agree.
- [ ] `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (≥ 12 chars) / `SEED_ADMIN_TENANT` — only needed for the first-deploy seed.

---

## D. First deploy (credential-gated)

- [ ] Set `RUN_SEED_ONCE=true` on `web` for the **first** deploy only, then **delete** the variable so re-deploys don't re-seed.
- [ ] Trigger the deploy; watch the `web` build log. If a domain is blocked (registry/font/host), surface it and allowlist it in Railway — **do not** vendor a mirror that hides the blockage.
- [ ] Confirm the `web` preDeploy ran `pnpm release` (migrate + one-time seed).
- [ ] Confirm the healthcheck passes: `GET /api/health` → `200 {"status":"ok","checks":{"db":true,"redis":true,"worker":true}}`. The `worker` has no inbound port; its liveness shows up as `checks.worker` via the heartbeat.
- [ ] Remove `RUN_SEED_ONCE` and rotate the seed admin password.

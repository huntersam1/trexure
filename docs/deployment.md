# Deploying Trexure

Per `railway.json` / `railway.web.json` / `railway.worker.json` / `nixpacks.toml`:

- **Platform:** Railway, using the Nixpacks builder, with Node 22 provisioned via
  `nixPkgs` and pnpm 10.6.4 activated via Corepack.
- **Services:** `web` (build: `pnpm install --frozen-lockfile && pnpm build`;
  pre-deploy: `pnpm release`; start: `pnpm start`; health check: `/api/health`) and
  `worker` (build: `pnpm install --frozen-lockfile`; start: `pnpm worker:prod`),
  sharing a Railway Postgres and Redis instance via internal networking variables
  (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`).
- **Restart policy:** `ON_FAILURE`, 5 retries (`web`) / 10 retries (`worker`).
- **File storage:** a Railway Volume mounted to `web` in production (S3-compatible
  gateway), MinIO locally — same storage abstraction code path.
- **Production env notes:**
  - Set `ENABLE_MOCK_ANCHOR=false` on `web`.
  - Set `APP_URL` to the canonical public origin (e.g. `https://app.trexure.xyz`).
    Mutating routes reject any request whose `Origin` header doesn't match `APP_URL`
    exactly, so pointing it at a stale host produces a `403 — Request origin not
    allowed`. `APP_URL` is also used to build claim links and emailed notes, so it must
    be the domain users actually browse.
  - `SHADOW_DATABASE_URL` is not needed.
  - Set `RUN_SEED_ONCE=true` only on first deploy, then remove it.
- **CI:** GitHub Actions runs typecheck/lint/test/build/audit on every push to
  `main`/`develop` and on all pull requests (`.github/workflows/ci.yml`).

## Staging

A live staging deployment runs at **https://app.trexure.xyz** (log in with the demo
accounts from the **Sample wallets & demo accounts** section of the
[README](../README.md)). It is the same `web` + `worker` topology as above on the
Railway staging environment; make sure `APP_URL=https://app.trexure.xyz` is set there.

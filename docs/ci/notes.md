# CI Notes — Trexure

## Gate sequence (run on every PR; mirrors `pnpm ci` and `.github/workflows/ci.yml`)
1. `pnpm install --frozen-lockfile`
2. Postgres 17 + Redis 7 service containers (MinIO for the guarded storage round-trip)
3. `pnpm exec prisma migrate deploy` (apply migrations to the CI database)
4. `pnpm typecheck` — TypeScript strict, 0 errors
5. `pnpm lint` — `eslint .`, 0 errors
6. `pnpm test` — Vitest, all AGENT §8 minimums green
7. `pnpm build` — `next build` (stricter typecheck incl. `typedRoutes`)
8. `pnpm audit --audit-level high` — 0 high/critical advisories

> The CI workflow (added in Phase 0) runs the `quality` (typecheck/lint/test against postgres+redis), `build`, and gating `audit` jobs on every PR to any base branch.

## AGENT §8 minimum coverage (all present & green)
- **Auth** — login success/failure, throttling, session lifecycle → `lib/auth/*.test.ts`, `app/api/auth/login/route.test.ts`.
- **Tenant isolation** — tenant A cannot read tenant B → `test/tenant-isolation.test.ts`, `tests/tenant-isolation.test.ts`, `lib/payments/service.test.ts`.
- **Webhook** — valid HMAC accepted, invalid rejected, duplicate idempotent → `app/api/webhooks/{fiat,chain}/route.test.ts`, `lib/webhooks/verify.test.ts`.
- **Reconciliation** — fiat-first AND chain-first reach SETTLED; double-reconcile no-op; failed leg → FAILED → `lib/reconcile/matcher.test.ts`, `tests/demo/failure-path.test.ts`.
- **Crypto** — AES-256-GCM round-trip + tamper; view key never serialized → `lib/crypto/aes.test.ts`, `lib/crypto/viewkey.test.ts`, `tests/crypto/view-key-not-serialized.test.ts`.

## Notes
- Integration tests share one Postgres/Redis; the suite runs single-fork (`pool: forks`, `singleFork: true`) so DB writes don't race. React component (`.tsx`) tests use a per-file `// @vitest-environment jsdom` docblock; node/DB suites stay on the node environment.
- `pnpm.overrides` pins `axios ^1.16.0` (clears the transitive `@stellar/stellar-sdk` highs) and `ioredis 5.10.1` (BullMQ pins it exactly — direct dep must be deduped). Keep `next` patched.

## SPEC §15 Acceptance Checklist — coverage map (Phase 9 Task 8)
Most items are proven by the automated suite; the rest were verified live during their phase or are deploy-time checks.

| Acceptance item | Covered by |
|---|---|
| A1 admin login; bad creds throttled + generic | `app/api/auth/login/route.test.ts` (generic 401, 429 throttle); E2E login cookie verified Phase 1 |
| A2 new payment → Soroban tx, stores proofHash + encryptedPayload | `lib/payments/service.test.ts` (Decimal, proofHash, ONCHAIN leg); real testnet submit is deploy-time |
| A3 view-key decrypt server-side; key never returned/logged | `app/api/payments/[id]/decrypt/route.test.ts` + `tests/crypto/view-key-not-serialized.test.ts`; **E2E decrypt verified Phase 6** (200 + payload, `viewKeyDisclosed:false`, audit row) |
| A4 fiat webhook valid HMAC → leg; invalid 401; duplicate idempotent | `app/api/webhooks/fiat/route.test.ts`; **E2E verified Phase 4** (200/duplicate/401) |
| A5 mock-anchor signed webhook → reconcile; `fail:true`→FAILED; 404 when flag off | `app/api/mock-anchor/payout/route.test.ts`, `lib/anchor/mock.test.ts`, `tests/demo/failure-path.test.ts` |
| A6 worker matches both legs on intent id → SETTLED + receipt | `lib/reconcile/matcher.test.ts` (both orderings, no-op), `lib/reconcile/receipt.test.ts` |
| A7 `GET /receipt` returns §6.4 shape | `lib/reconcile/receipt.test.ts` (exact key set); `app/api/payments/[id]/receipt/route.test.ts` |
| A8 Tenant A cannot read Tenant B | tenant-isolation suites (above) |
| A9 security headers; no secret in client bundle; audit clean | `middleware.test.ts` (CSP/HSTS/headers); gating `audit` CI job; build emits no `NEXT_PUBLIC_*` secrets |
| A10 no secret in git history | `.env` is gitignored and never committed; secrets only from env |
| A11 clean checkout boots end-to-end | **E2E verified Phase 5** (`worker:dev` + `/api/health` → `{"status":"ok",...}`) |
| A12 web + worker deploy on Railway, pass `/api/health` | deploy-time (see `docs/deploy/railway.md`); `worker:prod` boots + heartbeats locally |

## Acceptance run
- Suite: **187 passing / 1 skipped** (the guarded MinIO round-trip) across 56 files; `typecheck`/`lint`/`build` green; `audit --audit-level high` clean.
- Live during Phase 9: `pnpm worker:prod` boots, logs `worker started`, writes the Redis heartbeat; `/api/health` returns `ok`.
- A12 is the only item requiring a real Railway deployment (out of scope for this branch).

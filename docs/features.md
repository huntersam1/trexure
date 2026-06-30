# Features — shipped log

A running, append-only log of shipped features. One entry per merged change
(newest first). Each entry links the issue/PR and summarizes what landed.

---

## [Phase 6] ZK Shield/Decrypt Layer — #7

The ZK differentiator: `lib/zk` wrappers over the (vendored) forked-SPP stack,
real on-chain proof verification, and the server-side decrypt endpoint. No
circuits authored; proof verification is never mocked.

- **SPP isolation** (`lib/zk/spp-client.ts`) — lazy WASM-prover load
  (`isSppAvailable`/`sppProve`), tenant view-key resolution (`getShieldKey`),
  and `sppVerifyOnChain` (a **real** Soroban simulate call to the Groth16
  verifier `ZK_CONTRACT_ID`; a simulation error throws — never silently passes).
  Vendoring documented in `vendor/spp/README.md` + a `.gitmodules` placeholder.
- **Public surface** (`lib/zk/index.ts`) — frozen `ShieldedPayload`, `shield`
  (real SPP path **or** a clearly-labeled AES-wrap fallback under the tenant view
  key, SPEC §14.5), `decryptWithViewKey` (server-side AES-256-GCM),
  `verifyProofOnChain` (delegates to the real on-chain verify). Replaces the
  Phase 3 stub (now removed) — `lib/payments/service` auto-uses it via `@/lib/zk`.
- **`decryptSchema`** (`lib/validation/zk.ts`) — `.strict()`.
- **`POST /api/payments/[id]/decrypt`** — `requireSession` + `assertCsrf`,
  tenant-scoped lookup, `loadViewKey` → `decryptWithViewKey`, audit-log
  `viewkey.decrypt`; the view key is zeroized, never returned, never logged.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (143 passing, 1
guarded MinIO test skipped), and `next build` all green. `shield → decrypt`
round-trips; a wrong view key fails (tag mismatch); `verifyProofOnChain` invokes
the on-chain path (asserted, not bypassed). **End-to-end:** a payload shielded
under the seed tenant's real view key and stored on a payment decrypts via the
HTTP endpoint (session + CSRF) → `200` returning the exact payload,
`viewKeyDisclosed:false`, and a `viewkey.decrypt` audit row written.

**Notes / deviations:**
- Added `types/spp.d.ts` (`declare module "@trexure/spp"`) so the dynamic import
  of the not-yet-wired vendored prover typechecks (runtime try/catch → fallback).
- Task 5 adaptation: in our Phase 3, `shield` is called inside
  `lib/payments/service.ts` (not the route) — both import `@/lib/zk`, so swapping
  `lib/zk/index.ts` to the real impl wires it with no route/service change; the
  orphaned `lib/zk/stub.ts` was removed.
- `sppVerifyOnChain` casts the simulation `retval` (`unknown`) to the
  `scValToNative` parameter type; spp-client test mocks use `vi.hoisted()`.

---

## [Phase 5] Worker & Reconciliation — #6

The reconciliation engine: a standalone BullMQ worker, the order-independent
matcher, the §6.4 receipt builder, and the receipt endpoint.

- **Receipt builder** (`lib/reconcile/receipt.ts`) — `buildReceipt(paymentId)`
  recomputes FX/fees/slippage from on-chain + anchor data into the exact §6.4
  shape (amounts as decimal **strings**, never JS `number`); idempotent upsert.
- **Matcher** (`lib/reconcile/matcher.ts`) — `tryReconcile` requires both legs,
  matches on the intent-id join **plus** corridor **plus** amount-within-1%-FX
  (never amount alone), settles idempotently (`SETTLED`/`FAILED` terminal),
  order-independent (fiat-first and chain-first converge), `FAILED` on a failed leg.
- **Heartbeat + health** (`lib/worker/heartbeat.ts`) — Redis key with TTL;
  `/api/health` now reports `{ db, redis, worker }` (503 when degraded).
- **`watch-onchain` job** — polls `getContractEvents` for the payment's
  intentId topic; on match upserts the `CONFIRMED` ONCHAIN leg + enqueues
  `reconcile`; capped exponential backoff; timeout → `FAILED`.
- **`reconcile` job** — thin wrapper over `tryReconcile`, logs the result.
- **Worker entrypoint** (`worker/index.ts`) — attaches both BullMQ workers,
  heartbeat interval, graceful SIGTERM/SIGINT shutdown. Worker scripts pass
  `--conditions=react-server` so `server-only` is a no-op in plain Node.
- **`GET /api/payments/[id]/receipt`** — session **or** Bearer API key →
  tenant-scoped §6.4 JSON; problem+json on 401/404.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (134 passing, 1
guarded MinIO test skipped), and `next build` all green. Reconciliation
converges for both orderings; double-reconcile is a no-op; intent/amount
mismatch → `WAITING`; failed leg → `FAILED`. **End-to-end:** `pnpm worker:dev`
boots, logs `worker started`, writes the heartbeat, and `/api/health` returns
`{"status":"ok","checks":{"db":true,"redis":true,"worker":true}}`.

**Notes / deviations:**
- `receipt.ts`/`matcher.ts` import `Prisma` from `.../generated/prisma/client`
  (the generated dir has no index; the plan's bare `.../generated/prisma`
  wouldn't resolve).
- The `tryReconcile` test mock is typed `Promise<"SETTLED"|"WAITING"|"FAILED">`
  so `mockResolvedValueOnce("WAITING")` typechecks (the plan's `as const`
  narrowed it to `"SETTLED"`).

---

## [Phase 4] Webhooks & Mock Anchor — #5

Fiat/chain payout webhook ingestion over a raw-body HMAC contract, plus a
flag-gated Mock Anchor that fires a *real* signed webhook at the real endpoint.

- **Schemas** (`lib/validation/webhooks.ts`) — strict `fiatWebhookSchema`
  (§8.1 event), `chainWebhookSchema`, `mockPayoutSchema`.
- **HMAC verifier** (`lib/webhooks/verify.ts`) — `signHmac` + timing-safe
  `verifyHmac` over the **exact raw bytes** (a re-serialized body must not verify).
- **`POST /api/webhooks/fiat`** — reads `await req.text()` before parsing; HMAC
  verify → Zod → idempotency via `WebhookEvent(provider, externalId)` (duplicate
  → 200 no-op) → upsert FIAT leg keyed by `(paymentId, legType)` (`RECEIVED`, or
  `FAILED` + `Payment.status=FAILED` on `payment.failed`) → enqueue `reconcile`;
  unverified → logged for admin + 401, no leg; rate-limited.
- **`POST /api/webhooks/chain`** — same contract, writes the `ONCHAIN` leg
  (`CONFIRMED`) and backfills `Payment.proofHash` when absent.
- **Mock Anchor** (`lib/anchor/mock.ts`) — `triggerMockPayout` invents
  refs/FX/fee, builds a Xendit-shaped event, HMAC-signs it with
  `ANCHOR_CALLBACK_TOKEN`, and POSTs it to the real `/api/webhooks/fiat`
  (mock the provider, never the verification path). `import "server-only"`.
- **Mock routes** — `POST /api/mock-anchor/payout` + `GET /api/mock-anchor/payouts`,
  gated by `ENABLE_MOCK_ANCHOR` (**404 first**, before any session check).

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (110 passing, 1
guarded MinIO test skipped), and `next build` all green. **End-to-end** against
the dev stack: a signed event POSTed to the real `/api/webhooks/fiat` → `200` +
a `RECEIVED` FIAT leg in the DB; a duplicate event id → `200` no-op; a bad
signature → `401`.

**Notes / deviations:**
- `fiat/route.ts` annotates the shared `legData` with
  `satisfies Prisma.PaymentLegUncheckedUpdateInput` so the literal `status`
  isn't object-literal-widened to `string` (which wouldn't match the `LegStatus`
  enum); the chain route avoids this with `as const`.
- Test `.mock.calls[0]` indexing uses `!` for `noUncheckedIndexedAccess`.
- Skipped the plan's `vitest.config.ts` rewrite / `server-only` stub creation —
  Phase 0 already configured both (the plan's excerpt would have clobbered the
  richer config).

---

## [Phase 3] Stellar Client & Payments — #4

The payment spine: a tenant submits a server-signed Soroban private payment that
persists as `PENDING` with a shielded payload and enqueues the watch-onchain job.

- **Queue** (`lib/queue/index.ts`) — single ioredis connection + `watchOnchain`/
  `reconcile` BullMQ queues + frozen `QUEUE` constants.
- **ZK stub** (`lib/zk/stub.ts` + `index.ts`) — clearly-labeled `shield()`
  matching the frozen Phase 6 contract (`encryptedPayload`/`payloadNonce`/
  `proofHash`); never presented as a verified proof.
- **Stellar client** (`lib/stellar/client.ts`) — testnet Soroban
  `buildAndSubmitPrivatePayment` (server-signed, intentId in the tx memo),
  `getContractEvents`, `fundWithFriendbot`.
- **Validation** (`lib/validation/payments.ts`) — strict `createPaymentSchema`
  (amount kept as a decimal string), `listPaymentsQuerySchema` (limit clamped to
  100), `corridorFor`.
- **Idempotency** (`lib/idempotency.ts`) — tenant-scoped Redis Idempotency-Key
  cache.
- **Payment service** (`lib/payments/service.ts`) — `createPayment` (shield →
  Soroban submit → `Payment(PENDING)` + `ONCHAIN` leg as Prisma `Decimal` →
  enqueue), `listPayments` (cursor pagination), `getPaymentById`,
  `enqueueReconcile`; all tenant-scoped via `forTenant`.
- **Routes** — `POST`/`GET /api/payments`, `GET /api/payments/[id]`,
  `POST /api/payments/[id]/retry-reconcile` (session + CSRF + Idempotency-Key,
  `force-dynamic`).

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (87 passing, 1
guarded MinIO test skipped), and `next build` all green. Stellar SDK + queue are
mocked in tests (never hit testnet/Redis); the payment-service tests run against
the real dev DB and assert tenant isolation + `Decimal` storage.

**Notes / deviations:**
- Added a `pnpm.overrides` for **`ioredis` → 5.10.1**: BullMQ pins exactly
  5.10.1 while our `^5.4.2` resolved to 5.11.1, so the `Redis` instance didn't
  match BullMQ's `ConnectionOptions` type. The override dedupes to one copy.
- `payments/service.ts` casts the `payment.create` data to
  `Prisma.PaymentUncheckedCreateInput` (covers the `forTenant` tenantId
  injection + the AES `Buffer`→`Bytes` strictness in one assertion).
- `listPaymentsQuerySchema.limit` transforms (clamps) to 100 rather than `.max()`
  rejecting, per the plan's "clamps to 100" intent.
- Extended `test/helpers/db.ts#resetDb` to delete `ViewKey`/`AnchorConfig`/
  `ApiKey`/`Session` before tenants (the Phase 0 seed's ViewKey FK blocked the
  wipe). Generated-client imports point at `.../generated/prisma/client` (no
  index in the generated dir).

---

## [Phase 2] Crypto, Storage & API Keys — #3

At-rest cryptography, tenant ViewKey storage, the S3/MinIO abstraction, and
hashed tenant API keys that later phases (3, 5, 6, 8) consume.

- **AES-256-GCM** (`lib/crypto/aes.ts`) — `aesEncrypt`/`aesDecrypt` using
  `MASTER_ENCRYPTION_KEY`; 12-byte per-call nonce, 16-byte auth tag appended;
  decrypt verifies the tag (tamper detection).
- **ViewKey at-rest** (`lib/crypto/viewkey.ts`) — write-only `storeViewKey`
  (AES-encrypt + upsert) / server-side `loadViewKey` (decrypt, `AppError(404)`
  if absent); the plaintext key is never serialized into the record or a response.
- **Storage** (`lib/storage/index.ts`) — S3 client for MinIO (dev) / Railway
  (prod): `putObject`/`getObject`/`getSignedDownloadUrl` (default 900s TTL)/
  `ensureBucket`. Added `@aws-sdk/s3-request-presigner`.
- **API keys** (`lib/auth/api-key.ts`) — `generateApiKey` (`trx_sk_`-prefixed,
  shown once) + SHA-256 `hashApiKey` (hash-only persistence) + `resolveApiKey`
  (strips Bearer, looks up non-revoked key, stamps `lastUsedAt`).
- **Bearer helper** (`lib/auth/bearer.ts`) — `requireApiKey(req)` → tenant scope
  or `AppError(401)`, for programmatic routes.
- **Routes** — `POST /api/keys` (session + CSRF + strict Zod + audit
  `apikey.create`, plaintext returned once) and `DELETE /api/keys/[id]`
  (tenant-scoped revoke + audit `apikey.revoke`); shared
  `lib/http/respond.ts#problemFromError` mapper.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (60 passing, 1
guarded MinIO test skipped), and `next build` all green. AES round-trips and
detects tamper; ViewKey is never serialized as plaintext; API-key hash
lookup/revoke work. Real MinIO round-trip (put → get → presigned URL) confirmed
against the dev stack.

**Notes / deviations:**
- `viewkey.ts` asserts the AES `Buffer` to `Uint8Array<ArrayBuffer>` at the
  Prisma `Bytes` boundary (frozen `aesEncrypt` returns `Buffer`; Prisma 7's
  input type is stricter — the value stays a Buffer at runtime).
- `app/api/keys/route.ts` casts the `create` data to
  `Prisma.ApiKeyUncheckedCreateInput` because `forTenant` injects `tenantId` at
  runtime but the static type still requires it.
- Test mocks that eagerly reference module-scope vars use `vi.hoisted()`
  (aes/viewkey/bearer/keys-route) to avoid the vitest TDZ hoisting error.

---

## [Phase 1] Auth, Sessions & Middleware — #2

The authentication spine. Stacks on Phase 0 (#1).

- **Passwords** (`lib/auth/password.ts`) — argon2id hashing (OWASP baseline
  params) + constant-time `verifyPassword` that returns `false` (never throws)
  on a malformed hash.
- **Rate limiting** (`lib/auth/rate-limit.ts`) — Redis fixed-window counter
  (`INCR`/`EXPIRE`/`TTL`) returning `{ allowed, retryAfterSec }`.
- **Sessions** (`lib/auth/session.ts`) — opaque 256-bit token; only its SHA-256
  hash stored in `Session.tokenHash`; `__Host-`cookie (`HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, no Domain); 24h sliding + 7d absolute expiry; logout
  deletes the row. `getSessionUser`/`requireSession`/`requireAdmin` (401/403 via
  `AppError`).
- **CSRF** (`lib/auth/csrf.ts`) — signed double-submit token (HMAC-SHA256 over
  `CSRF_SECRET`) + `Origin`/`Sec-Fetch-Site` check; timing-safe compares.
- **Login schema** (`lib/validation/auth.ts`) — `.strict()` Zod `loginSchema`.
- **Auth routes** — `POST /api/auth/login` (per-IP + per-username throttle,
  anti-enumeration dummy-hash verify, generic 401, `auth.login` audit log,
  429 + `Retry-After`), `POST /api/auth/logout` (session + CSRF), `GET
  /api/auth/session`.
- **Middleware** (`middleware.ts`) — Edge auth-presence gate (public allowlist:
  `/login`, `/api/auth/login`, `/api/webhooks/*`, `/api/health`; page → 307
  `/login`, API → 401 problem+json) + nonce-based CSP, HSTS, and the standard
  security headers; forwards an `x-nonce` request header for RSC.
- **Tests** — 39 passing: unit suites for each primitive, the login route
  (success / generic-fail / unknown-user / 400 / 429), middleware, and a
  cross-tenant isolation integration test under a `requireSession` context.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (39), and
`next build` all green. End-to-end smoke confirmed: `POST /api/auth/login`
(seeded admin) → 200 + `__Host-` session cookie; `GET /api/auth/session` with
that cookie → the admin `SessionUser`; missing cookie / wrong password → 401.

**Notes / deviations:**
- Phase 0's `vitest.config.ts` only matched `test/**`; broadened `include` to
  `**/*.test.ts` (excluding `node_modules`/`.next`/`lib/generated`/`dist`) so the
  co-located Phase 1 suites run.
- Login route test rewritten to create its mock fns via `vi.hoisted()` (the
  plan's version hit a TDZ error because `vi.mock` is hoisted above the
  top-level `const` mock declarations). Added a `user-agent` header to that
  test request so the `createSession` UA arg is asserted meaningfully.
- Next 16.2 deprecates the `middleware.ts` convention in favor of `proxy.ts`
  (still builds/runs as "Proxy (Middleware)"). Kept `middleware.ts` per the
  plan/AGENT; migration to `proxy.ts` is a tracked follow-up.

---

## [Phase 0] Foundation & Scaffolding — #1

Repo scaffold that boots from a clean checkout. Establishes the stack, the
database, and the cross-cutting libs every later phase consumes.

- **Tooling:** pnpm 10 workspace, Node ≥22, TypeScript 5 strict (`@/*` alias),
  `.gitignore`/`.npmrc`/`.nvmrc`.
- **Next.js 16.2 App Router** (Turbopack) scaffold with native flat ESLint
  config (`eslint-config-next` 16), `serverExternalPackages` for native modules.
- **Tailwind v4** CSS-first theme (BRAND §3 `@theme` tokens) + `next/font`
  typography (Geist / Inter / JetBrains Mono) + Material Symbols loader.
- **Local dev stack:** `docker-compose.yml` (postgres:17, redis:7, minio).
- **Env:** `.env.example` (all SPEC §11 keys) + `lib/env.ts` Zod fail-fast
  validation (validates the 32-byte `MASTER_ENCRYPTION_KEY`).
- **Cross-cutting libs:** `lib/log.ts` (pino with redaction paths) and
  `lib/http/problem.ts` (RFC-9457 `application/problem+json` + `AppError`).
- **Prisma 7:** full SPEC §7 schema (4 enums + 11 models), `prisma.config.ts`
  (connection URLs + seed), `@prisma/adapter-pg` driver adapter, and a
  `forTenant()` query extension that forces `tenantId` on every tenant-scoped
  read/write.
- **Migration + seed:** initial migration; idempotent seed (tenant, argon2id
  admin, encrypted ViewKey, mock-anchor AnchorConfig, one shielded sample
  Payment with an on-chain leg).
- **`/api/health`:** liveness route pinging DB + Redis + worker heartbeat
  placeholder; `503` problem+json when a dependency is down.
- **Tests (Vitest):** RFC-9457 `problem()`/`AppError` unit tests and the
  SPEC §15 cross-tenant isolation proof (Tenant A cannot read Tenant B).
- **CI (GitHub Actions)** — `.github/workflows/ci.yml` on push/PR to
  `main`/`develop`: a `quality` job (postgres:17 + redis:7 services →
  `prisma generate` → `migrate deploy` → typecheck → lint → test), a `build`
  job (`next build`), and a gating `audit` job (`pnpm audit --audit-level high`).
  `packageManager` pinned to `pnpm@10.6.4` for deterministic installs.
- **axios override** — `pnpm.overrides` forces `axios@^1.16.0` (resolves
  1.18.1), clearing the 11 high-severity advisories transitively pulled by
  `@stellar/stellar-sdk` (which pins axios 1.15.0). Verified the SDK still works
  end-to-end: Keypair sign/verify, TransactionBuilder XDR roundtrip, and live
  Horizon (`feeStats`) + Soroban RPC (`getLatestLedger`) axios calls. Audit now
  reports 0 high (2 moderate remain).

**Verification:** `pnpm typecheck`, `pnpm lint`, and `pnpm test` (6 tests) all
green; `/api/health` returns `200 {"status":"ok",...}` against the dev stack.

**Notable deviations from the plan (Prisma 7.8 / Next 16.2 reality):**
- Connection URLs moved from the schema `datasource` block into
  `prisma.config.ts` (`datasource: { url, shadowDatabaseUrl }`) — Prisma 7.8
  no longer accepts `url`/`shadowDatabaseUrl` in the schema.
- Enums expanded to one value per line (7.8 parser rejects single-line enums).
- `lint` script switched from `next lint` (removed in Next 16) to `eslint .`
  using the native flat config; dropped `FlatCompat`.
- `typedRoutes` moved out of `experimental` to top-level in `next.config.ts`.
- Seed writes `Bytes` columns as `Uint8Array<ArrayBuffer>` (Prisma 7 `Bytes`
  type) instead of Node `Buffer`.

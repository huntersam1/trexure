# Features — shipped log

A running, append-only log of shipped features. One entry per merged change
(newest first). Each entry links the issue/PR and summarizes what landed.

---

## Public landing page at `homepage/index.html` — #39

The app was login-gated at `/`, so a visitor with no credentials saw only a
sign-in box. Added a standalone, self-contained marketing page.

- **`homepage/index.html`** — plain HTML + inline CSS, no framework, no build
  step, and **zero external network dependencies** (renders offline). Reuses the
  brand tokens from `app/globals.css` (violet `#8E44AD`, gold `#D4AF37`, ink
  `#1A1025`, off-white `#F7F9FB`; Geist/Inter/JetBrains Mono stacks) and an
  inline-SVG logo mark built from the `LOGO.md` concept (shield · two converging
  streams · keyhole notch).
- **Content, all traceable to `README.md`/`SPEC.md`** — the four-beat hero flow
  (Shield → Decrypt → Reconcile → Receipt), the problem framing, the three-part
  moat (Stellar-native · ZK-private · locally reconciled), and an honest
  "what's real vs. mocked" table (ZK verification is genuinely on-chain; the
  Mock Anchor is the only stand-in). No fabricated features, metrics, or partners.
- **CTAs** — Sign in (`/login`), Create a workspace (`/signup`), and a link to
  the recorded demo (`../docs/demo/trexure-demo.mp4`, resolved when served from
  the repo root). README documents how to serve it.

**Verification:** served from the repo root (`python3 -m http.server`) → HTTP
200, `/login` + `/signup` + demo-video links all resolve; headless Chrome render
shows no console errors and no missing assets.

---

## New Payment flow env-gated until the transfer contract is live — #32

"New Payment" sat in the main nav while submission 500'd (see #29/#30/#31) —
a judge could hit an unhandled error on the most inviting button in the UI.

- **Flag** — `ENABLE_NEW_PAYMENTS` (default **false**; flip to `true` once the
  `shielded_transfer` contract from #31 is deployed). No code churn to re-enable.
- **API** — `POST /api/payments` returns a clear **503 problem+json**
  ("New payments unavailable") when gated off — gate runs first, so no
  unhandled 500 is reachable. GET/list unaffected.
- **UI** — `/payments/new` renders an explanatory card ("Shielded transfer
  contract — in progress") with a Demo Replay link instead of the form; the
  sidebar nav item gets a `soon` badge with a tooltip. Seeded Demo Replay
  unaffected.
- **Tests** — gated 503 route test; Sidebar badge tests (jsdom).

**Verification:** `typecheck`/`lint`/`test`/`build` green. Live check with the
flag off: POST → `503 application/problem+json`; `/payments/new` renders the
card (no form); badge visible.

---

## Fix: New Payment CSRF 403 (duplicate cookie) — #29

The New Payment server action (`app/(app)/payments/new/actions.ts`) forwarded
the browser's cookie jar and *appended* a freshly issued CSRF cookie, so the
header carried two `__Host-trexure_csrf` cookies; `readCsrfCookie()` picked the
stale login-time one and `assertCsrf()` rejected every submission with 403
"Invalid CSRF token."

- **Fix** — new `forwardedCookieHeader()` helper in `lib/auth/csrf.ts` drops any
  existing CSRF cookie from the jar before appending the fresh double-submit
  token; the action now uses it.
- **Tests** — regression coverage in `lib/auth/csrf.test.ts` for the
  duplicate-cookie scenario and the helper's dedupe behavior.

**Verification:** `typecheck`/`lint`/`test`/`build` green.

---

## New payments run end-to-end on testnet (`shielded_transfer`) — #31

Brand-new payments previously died at simulation: the client invoked
`shielded_transfer` on a contract that only exposed `verify`. Only the seeded
demo payment could complete its lifecycle.

- **Contract** — added a `shielded_transfer(intent_id, amount, source_asset,
  commitment)` entrypoint to the Groth16 verifier contract (`zk/verifier/`),
  publishing a contract event (`topics=(intent_id,)`, `data=commitment`). It is
  a clearly-labeled **commitment recorder** — no token movement, no
  notes/nullifiers (future work). Rust unit test covers the event shape.
- **Deploy** — rebuilt + deployed to testnet:
  `CBCYXVZCNMQEHLN6NN375KUK2IK54PF3XUB6FMZG2J26K7A4WH2ZVTSG`
  (`zk/deploy.json` updated; `verify` behavior unchanged — `pnpm zk:demo`
  passes against the new id).
- **Client** — `buildAndSubmitPrivatePayment` now passes the payment's
  `proofHash` as the recorded commitment; `getContractEvents` filters by the
  intentId topic as an XDR-encoded ScVal (raw text never matched on the real
  RPC) and decodes event values via `scValToNative`.
- **Docs** — README "What's not yet wired", pitch deck "What's next", and
  `docs/zk.md` updated to reflect the live path + the honest scope.

**Verification:** `typecheck`/`lint`/`test`/`build` + `cargo test` green.
Live E2E on a fresh local stack: `POST /api/payments` → real testnet tx →
watch-onchain confirmed from the contract event (stored `proofHash` = the real
commitment) → mock payout → reconcile → **SETTLED** with receipt and an
explorer-linkable tx hash.

---

## Fix: Soroban submission rejected classic memo — #30

Every brand-new payment failed at creation: `buildAndSubmitPrivatePayment`
attached the reconciliation `intentId` via `Memo.text`, and the stellar-sdk
rejects classic memos on Soroban transactions at `prepareTransaction`.

- **Fix** — the Soroban tx no longer carries a memo (`lib/stellar/client.ts`);
  the `intentId` already travels as the first contract-call argument and the
  watch-onchain worker matches on contract events, so reconciliation is
  unaffected. The optional user memo now rides in the shielded payload only
  (`lib/payments/service.ts`).
- **Docs** — stale "intentId in the tx memo" claims corrected in `README.md`,
  `SPEC.md`, and code comments.
- **Tests** — regression test asserting no memo is ever attached.

**Verification:** `typecheck`/`lint`/`test` green; live testnet probe passes
`prepareTransaction` (next failure is the missing `shielded_transfer` contract
function — tracked in #31).

---

## Self-serve signup — outside users can try Trexure — #33

There was no self-serve registration: users had to be provisioned by an admin
into an existing tenant, so an outside user (e.g. a hackathon judge) couldn't
try the product without being handed credentials.

- **Provisioning service** (`lib/auth/signup.ts`) — one transaction creates a
  Tenant, an ADMIN user (argon2id), a tenant view key (AES-256-GCM under the
  master key, mirroring `prisma/seed.ts`), a default mock-anchor
  `AnchorConfig`, and a **demo-ready sample shielded payment** (payload
  encrypted under the tenant view key; `proofHash` = the real ZK commitment;
  CONFIRMED on-chain leg, no fiat leg) so Demo Replay runs on first landing.
- **API** — `POST /api/auth/signup`: zod-validated (admin password policy,
  min 12 chars), per-IP rate-limited (5/hour — stricter than login),
  audit-logged (`auth.signup`), session created on success; problem+json
  errors (422/429/409/500, generic detail — no internals leaked).
- **UI** — `/signup` page + form mirroring the login screen (same-origin
  check, CSRF cookie seeded like the login action, field-level errors);
  `/login` ↔ `/signup` cross-links. Both routes public in the middleware.
- **Tests** — service-level DB tests (provisioning completeness, duplicate
  username → 409 with full rollback, `forTenant()` isolation between two
  signed-up tenants), route tests (201/422/429/409/500), middleware coverage.

**Verification:** `typecheck`/`lint`/`test`/`build` green (60 files, 201
passed). Live: `POST /api/auth/signup` → session → tenant-scoped payments list
shows only the new tenant's sample payment → `/decrypt` round-trips under the
new tenant's own view key.

---

## Real Zero-Knowledge Proofs (Groth16 on Soroban testnet)

Replaced the placeholder ZK story (AES + a SHA-256 hash, with the real
prover/verifier not wired) with a **genuine** zero-knowledge proof system.

- **Circuit + setup** — `zk/circuits/commit.circom` (knowledge-of-opening of a
  public commitment), compiled over **BLS12-381**; Groth16 trusted setup via
  snarkjs (`zk/artifacts/`).
- **On-chain verifier** — a Soroban contract (`zk/verifier/`) running the Groth16
  multi-pairing check with BLS12-381 host functions, **deployed to testnet**
  (`zk/deploy.json`).
- **Prover + bridge** — `lib/zk/groth16.ts` (real snarkjs proving + the
  snarkjs→Soroban byte encoding, locked by brute-forcing a known-good proof).
- **App integration** — `POST /api/payments/[id]/verify-proof` regenerates the
  proof from the tenant view key and verifies it on-chain; surfaced by a
  **"Verify proof on-chain"** button. The seed binds the sample payment's
  `proofHash` to the real commitment. `shield` does real proving when
  `ZK_PROVING=live`, else a labeled fallback that never fakes verification.
- **Runnable proof** — `pnpm zk:demo`: a fresh proof verified live on testnet,
  with a tampered statement rejected (`false`).

**Verification:** `typecheck`/`lint`/`build` green; suite green (added
`lib/zk/commit.test.ts`); live `verify-proof` → `{ verified: true }`. See `docs/zk.md`.

---

## [Phase 9] Demo Replay, Export & Deploy — #10 (final phase)

The demo orchestration, failure path, PDF export, Railway deploy config, and the
SPEC §15 acceptance map — the finishing layer over the full spine.

- **Demo reset** (`lib/demo/reset.ts` + `POST /api/payments/[id]/demo-reset`) —
  idempotent reset of the sample payment (drop FIAT leg + receipt → PENDING,
  keep the on-chain leg) so replay can repeat.
- **Demo Replay controller** (`components/demo/DemoReplayController.tsx`) — paced
  4-beat orchestration (reset → decrypt → mock payout → poll until SETTLED →
  receipt), wired into the dashboard and the sample payment page; drives RSC
  re-reads via `router.refresh()`.
- **Failure path** — `RetryReconcileButton` shown on `FAILED`, plus an
  integration test proving a FAILED leg fails the payment and a reset-then-RECEIVED
  leg settles.
- **Receipt PDF export** (`lib/pdf/receipt.ts`, `POST /api/payments/[id]/receipt/pdf`)
  — server renders the §6.4 receipt with `pdfkit` → `lib/storage` → signed URL,
  wired into the receipt page (`pdfkit` added to `serverExternalPackages`).
- **Railway deploy config** — `railway.json`/`railway.web.json`/`railway.worker.json`,
  `nixpacks.toml`, `scripts/release.sh` (migrate deploy + guarded one-time seed),
  `docs/deploy/railway.md`.
- **CI notes + SPEC §15 acceptance map** (`docs/ci/notes.md`) + an AGENT §8
  view-key-never-serialized test; **demo-day runbook** (`docs/demo/runbook.md`).

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (188 passing, 1
guarded MinIO test skipped), and `next build` all green. `worker:prod` (tsx)
boots and writes the Redis heartbeat; `/api/health` → `ok`.

**Notes / deviations:**
- **CSRF correctness fix:** the Phase 7 payment-detail page issued a *fresh*
  CSRF token (which wouldn't match the login-set `__Host-trexure_csrf` cookie);
  switched it (and all new islands) to read the cookie value. Demo/retry/export
  buttons take a `csrfToken` prop (not the plan's nonexistent meta tag).
- **Task 5 skipped** — DB+Redis+worker-heartbeat in `/api/health` was already
  delivered by Phase 5, and Phase 8's HealthPanel consumes that shape; the plan's
  rewrite would have broken it.
- **Worker prod via `tsx`** (`worker:prod`) instead of `node dist/...`: the worker
  imports `lib/` through the `@/*` alias, which a plain `tsc` build can't resolve
  at runtime. `tsx` resolves the paths + `react-server` condition.
- `vitest.config` kept as-is (the plan's `include: tests/**` would have dropped
  all co-located suites; its global DB-wipe `setup.ts` would have destabilized
  passing tests). PDF export wired through `ReceiptActions` rather than two
  separate button components. `FAILED` is terminal in our matcher, so the
  failure-path recovery runs through a reset.

---

## [Phase 8] Admin, Settings & API-Key UI — #9

Tenant Settings (write-only ViewKey, anchor config, webhook-secret rotation),
the API-keys management page, the ADMIN-only console + webhook log, the
supporting admin API routes, and audit-log surfacing — all tenant-scoped or
role-gated, Zod-validated, problem+json, and audited.

- **Foundations** (`lib/audit/log.ts` `recordAudit` best-effort; `lib/admin/queries.ts`
  global reads; `lib/validation/{admin,settings}.ts` `.strict()` schemas).
- **Admin API** — `GET /api/admin/tenants`, `POST /api/admin/users`
  (requireAdmin + CSRF + Zod + argon2id; never echoes passwordHash),
  `GET /api/admin/webhook-events` (verification + idempotency). All audited.
- **Settings** (`lib/settings/{load,actions}.ts`) — redacted `getSettingsView`
  (no key material; only a sha256 fingerprint chip) + Server Actions:
  `saveViewKeyAction` / `saveAnchorConfigAction` / `rotateWebhookSecretAction`.
  tenantId always from the session, never the form; webhook secret stored
  AES-256-GCM nonce-prefixed; rotation reveals the new secret once.
- **Pages** — `/settings` (write-only ViewKey + anchor + rotation),
  `/settings/api-keys` (create-once / list / revoke), `/admin` (tenants, create
  user, live worker/db/redis health, webhook summary, audit read view),
  `/admin/webhooks` (raw inbound event log). ADMIN pages role-gated by
  `requireAdmin`.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (181 passing, 1
guarded MinIO test skipped), and `next build` all green; new routes present
(`/settings`, `/settings/api-keys`, `/admin`, `/admin/webhooks`, + 3 admin APIs).

**Notes / deviations from the plan (adapted to real prior-phase code):**
- CSRF: the plan's client islands read a JS-readable `csrf_token` cookie, but the
  real double-submit cookie is `__Host-trexure_csrf` and **HttpOnly**. The RSC
  pages read it server-side and pass the token as a `csrfToken` prop to the
  islands (which echo it in `x-csrf-token`). Settings forms use Server Actions
  (Next origin-checks them) — no manual token.
- `storeViewKey` takes a `Buffer` (not the string the plan assumed); the action
  converts the form text via `Buffer.from(text, "utf8")`.
- Anchor `webhookSecret` (Bytes) + tenant-scoped `upsert`/`update` via `forTenant`
  use `as unknown as Prisma.AnchorConfig{Unchecked…Input}` casts (Buffer→Bytes +
  injected tenantId), runtime values unchanged.
- `HealthPanel` reads the real `/api/health` shape (`checks.{db,redis,worker}` +
  `worker.lastBeatMs`), not the plan's `{ db, redis, worker.alive/lastHeartbeatAt }`.
- `createUserSchema.tenantId` is `z.string().min(1)` (not `.cuid()`) because the
  seed HQ tenant id (`seed_tenant_trexure_hq`) isn't a cuid.
- `admin/users` route projects only safe response fields (never echoes
  passwordHash regardless of the row shape).
- Create-key/revoke islands use `router.refresh()` (not `window.location.reload()`)
  so the shown-once secret survives the list refresh.
- Several plan test mocks adjusted: `vi.hoisted()` for module-scope mock vars;
  the rotate test's `forTenant` mock gained `update`; `storeViewKey` expectation
  is a Buffer; the admin page-guard / webhooks-page tests assert the
  `requireAdmin` gate is invoked (the 403 path is covered by the admin route
  tests) to avoid a vitest unhandled-rejection artifact when invoking the async
  Server Component default export in the reject path.

---

## [Phase 7] Frontend Shell & Payment Lifecycle — #8

The authenticated app shell, brand component library, and the four-state
payment lifecycle (Shield → Decrypt → Reconcile → Receipt), all wired to the
Phase 1/3/4/5/6 APIs and styled strictly from BRAND.md (Plum & Gold, semantic
tokens only, mono for hashes/amounts/refs, motion with `prefers-reduced-motion`).

- **Shell & primitives** — `app/(app)/layout.tsx` (session-guarded sidebar +
  scroll main), `components/ui/{Icon,Button,KpiStat,CopyButton,StatusBadge,Stepper}`,
  `components/shell/{Sidebar,DemoReplayButton}`, motion/icon/scrollbar CSS.
- **Pure logic (TDD)** — `lib/ui/status.ts` (BRAND §8 status→badge mapping),
  `lib/ui/stepper.ts` (node state + fill math), `lib/ui/{types,format}.ts`.
- **Data + client** — `lib/data/payments.ts` (server-only tenant-scoped reads),
  `lib/api/client.ts` (CSRF-aware `apiGet`/`apiPost`), `lib/validation/payment-ui.ts`.
- **Routes** — `/login` (form + server action), `/` dashboard (KPI strip +
  recent payments + Demo Replay placeholder), `/payments` (filter + pagination),
  `/payments/new` (create form → `POST /api/payments`), `/payments/[id]`
  (the four-beat `PaymentLifecycle` orchestrator: `PublicLedgerView` →
  `EnclavePanel` decrypt → `ReconciliationRow` line-draw → `ReceiptPanel`, with
  gated steps + Advanced drawer), `/receipts/[id]` (standalone shareable receipt).

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (157 passing, 1
guarded MinIO test skipped — includes new React component tests under jsdom),
and `next build` all green; all routes present (`/`, `/login`, `/payments`,
`/payments/[id]`, `/payments/new`, `/receipts/[id]`).

**Notes / deviations:**
- vitest config: added `*.test.tsx` to `include` and jsdom + @testing-library/react;
  component tests use a per-file `// @vitest-environment jsdom` docblock so the
  node/DB suites keep their node environment.
- `EnclavePanel` reads `res.payload` — the Phase 6 decrypt route returns
  `{ payload, proofHash, privacy }`, not the bare payload the plan assumed.
- Removed Phase 0's placeholder `app/page.tsx` (it conflicted with the authed
  dashboard at `app/(app)/page.tsx`; both resolved to `/`, and the static
  placeholder was winning — now the dynamic dashboard owns `/`).
- `Sidebar` casts the forward-referenced `/settings` and `/admin` hrefs to
  `Route` (those pages land in Phase 8; `typedRoutes` rejects unknown routes at
  build time even though plain `tsc` passes).
- Dropped an unused `truncateHash` import the plan included in `ReceiptPanel`.

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

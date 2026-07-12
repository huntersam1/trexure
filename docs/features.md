# Features — shipped log

A running, append-only log of shipped features. One entry per merged change
(newest first). Each entry links the issue/PR and summarizes what landed.

---

## Correctness: money as Decimal string, not float (H2) — #143

A High finding. The pool + HR payout path ran money through JS `number`:
`BigInt(Math.round(amount * 1e7))` (float × 1e7), `z.coerce.number()` amount
schemas, and `successTotal += receiver.amount` (float accumulation). Safe only
because `/pool` caps at 10 000 XLM — but the **HR salary/advance/conversion
payouts bypass that cap** and cast `Prisma.Decimal → Number`, so a large salary
could exceed 2^53 stroops and silently lose precision.

Money now threads a **Decimal string** end-to-end, never a float:

- **`lib/validation/pool.ts`:** a shared `xlmAmount` schema — normalizes a JSON
  number to its string form, then validates with `Prisma.Decimal` (positive,
  ≤ 10 000, ≤ 7 dp). Used by the deposit / demo / batch-receiver schemas.
- **`lib/pool/service.ts`:** new `xlmToStroops(amount: string)` converts via
  `Prisma.Decimal` (exact above the 2^53 boundary) and **throws** on sub-stroop
  (> 7 dp) precision rather than rounding money away. `PoolDepositResult.amount`
  is now a string.
- **`lib/pool/batch.ts`:** accumulates the batch total as `Prisma.Decimal`;
  result `amount` / `totalSourceAmount` are strings.
- **HR routes** pass the Decimal string straight through (dropped `Number(...)`).
- **Pool client** (`PoolRail` / `BatchRail`) sends the raw string on the wire.

Tests: `xlmToStroops` stays exact at `9007199254740993` stroops where
`Math.round(amount*1e7)` loses it; schema rejects > 7 dp / over-cap / non-positive;
batch total accumulates as a string.
## Correctness: atomic idempotency on payment creation — #143

A Medium finding. `POST /api/payments` did check-then-act (`getCachedIdempotent`
→ `createPayment` → `setCachedIdempotent`), so two concurrent requests with the
same `Idempotency-Key` both missed the cache and both submitted a real Soroban tx
+ created duplicate `Payment`s.

Now `lib/idempotency.ts` exposes `reserveIdempotent` (`SET NX` with a short
placeholder TTL): exactly one caller wins the reservation and reaches
`createPayment`; a loser returns the finalized id (200, idempotent) or, if the
winner is still in flight, **409** to retry. The reservation is released on a
`createPayment` failure so a legitimate retry isn't locked out, and auto-expires
(5 min) if the request crashes mid-flight.

## Security: audit trail on money-moving HR routes — #143

A Medium finding. `recordAudit` covered admin/report/settings actions but not the
HR payout paths, so a successful disbursement left no queryable actor+amount
record. Added a structured audit row (with caller IP) on the success path of:

- `POST /api/hr/advances/[id]/approve` → `hr.advance.disburse`
- `POST /api/hr/conversions/[id]/approve` → `hr.conversion.disburse`
- `POST /api/hr/employees/[id]/pay-salary` → `hr.salary.payout`

Each records the actor, tenant, target, and money metadata (amount / net /
gross-deduction-repaid) only **after** the payout succeeds — a failed payout
(502) or CSRF/flag rejection writes nothing.

## Security: harden the demo-gated mock-anchor routes — #143

A Medium finding. Both `mock-anchor` routes are behind `ENABLE_MOCK_ANCHOR`, but
tightened before that flag is ever on outside dev:

- **`POST /api/mock-anchor/payout`** now calls `assertCsrf(req)` — it's a
  state-changing POST that was authenticated but had no CSRF check.
- **`GET /api/mock-anchor/payouts`** is tenant-scoped: `WebhookEvent` is a global
  model, so it returned every tenant's payout payloads to any signed-in member.
  It now filters events to those whose `payload.intentId` maps to a payment the
  caller's tenant owns (via `forTenant`).

## Correctness: guard salary-advance settlement against concurrent double-settle — #143

Third slice of the #143 audit (a Medium). `settleAdvancesForPayout`
(`lib/hr/advances.ts`) read the employee's DISBURSED advances **outside** any
transaction and then updated each **by `id` alone** — no status/outstanding
guard. Two concurrent `pay-salary` runs for one employee both read the same
outstanding and both wrote, silently losing one update (the ledger dropped once
though the employee was charged twice; a partial deduction could also leave a
stale outstanding).

Fix: do the read **and** the guarded writes in one interactive `$transaction`,
each write a **compare-and-set** (`updateMany where { id, status: "DISBURSED",
outstanding: <as-read> }`). If a concurrent run already moved the advance, the
stale write matches 0 rows → the whole settlement throws (409) and rolls back
instead of double-decrementing. Matches the existing approve/disburse/reject
guard pattern in the same file; the `pay-salary` route already surfaces a
settle-time throw for reconciliation. Regression test drives two racing
settlements and asserts the total repaid equals the true outstanding (not 2×).

## Demo: HR-payroll video walkthrough — #144

Recorded walkthrough of the employee / HR-payroll suite (#133/#134/#135) so it
can sit alongside the other demo recordings. New `scripts/record-hr.mjs` +
`pnpm demo:record:hr` (Playwright → ffmpeg, mirroring `record-audit-link.mjs`)
drives one continuous ADMIN flow: onboard an employee with a base salary and a
convertible non-monetary benefit → request a salary advance, **approve & pay** it
through the pool rail, **Run salary payout** (advance netted FIFO, marked
repaid) → convert part of the benefit to cash and **approve & pay** it.

The approve-&-pay / salary-run / convert steps settle on the pool rail (real
testnet), so the recorder needs `ENABLE_POOL_RAIL=true` + a funded
`STELLAR_SOURCE_SECRET`; it also pre-warms the authed routes (Next dev compiles
on first hit) so the recorded pass is smooth. Output committed to
`docs/demo/trexure-hr.mp4` (~50s); linked from the README and the demo runbook.

## Performance: missing database indexes — #143

Second slice of the #143 audit — the High/Medium **missing-index** findings.
Adds four indexes (migration `add_perf_indexes`), all additive, no behavior
change:

- **`Payment(poolCommitment)`** (H3) — `lib/receiver/claim.ts` looks up the
  disbursement by note commitment with **no** tenant filter, so it couldn't ride
  the `[tenantId, …]` composites and did a full table scan on **every** claim.
  Confirmed via `EXPLAIN`: now an index scan.
- **`Notification(paymentId)`** — `markNotificationsClaimedForPayment` updateMany's
  by `paymentId` on every claim (the FK column isn't auto-indexed in Postgres).
- **`WebhookEvent(provider, createdAt)`** — provider-filtered, newest-first
  scans (mock-anchor payouts view).
- **`AuditLog(createdAt)`** — the platform-operator audit list reads newest-first
  with no tenant filter, which the `[tenantId, createdAt]` composite can't serve.

Deliberately **not** indexed: `Payment.poolNullifierHash` — it's only ever
written / read on an already-loaded row, never a `where` key, so an index there
would only add write cost. (H4 unbounded reads, H1 webhook trust model, and H2
money-as-float remain open in #143.)

## Security C1: platform-admin boundary closes cross-tenant takeover — #143

First slice of the #143 security audit — the **critical** finding (C1). The
`/admin` console was built as a cross-tenant *operator* view (enumerate every
tenant, create users in any tenant, read the global webhook/audit logs) but was
gated only by `requireAdmin()`, i.e. `role === "ADMIN"`. Since self-signup makes
every user an ADMIN of its own tenant, any tenant admin could enumerate a victim
tenant and mint an ADMIN inside it → full multi-tenant account takeover.

- **New `User.isPlatformAdmin` flag** (`Boolean @default(false)`, migration
  `add_platform_admin_flag`). `role` stays a per-tenant role; this is the
  cross-tenant operator boundary.
- **New `requirePlatformAdmin()`** in `lib/auth/session.ts` (requires the flag,
  not just ADMIN). The `/api/admin/{users,tenants,webhook-events}` routes now use
  it (403 for non-operators); the `/admin` + `/admin/webhooks` pages use
  `requireSession()` + `notFound()` so the console's existence isn't disclosed.
- **Seed:** the HQ operator (`SEED_ADMIN_USERNAME`) is the sole `isPlatformAdmin`,
  so the console keeps working in demos while self-signup admins stay confined to
  their own tenant. Tenant-scoped admin operations (HR, reports) are unchanged —
  they remain on `requireAdmin`.

## UI polish slice 1: App Router state files + silent-failure fixes — #141

First slice of the #141 UX audit (P0-1 and P0-4). The app previously had zero
`error.tsx`/`loading.tsx`/`not-found.tsx` files — any server error rendered
Next's unstyled default screen — and two recovery actions failed silently.

- **State files:** root `app/global-error.tsx` (self-contained, inline-styled —
  renders when the root layout itself throws), root `app/not-found.tsx`
  (branded 404 for unmatched URLs and the 21 `notFound()` role/flag gates, with
  a back-to-dashboard path), `app/(app)/error.tsx` (branded boundary inside the
  shell with **Try again** via `reset()` + error digest), `app/(app)/loading.tsx`
  (skeleton of the common page shape; `motion-reduce` respected).
- **Silent failures fixed:** `RetryReconcileButton` and `RevokeKeyButton` now
  check `res.ok`, catch network errors, and show an inline `role="alert"`
  message instead of failing invisibly; `DemoReplayController` surfaces a
  visible "Replay failed" message (previously only a `data-beat` attribute).
- **Tests:** 8 new jsdom tests (success/non-ok/network per button, error
  boundary render + reset). Live-verified the branded 404 on the dev server.

## Salary advance / earned wage access — #134

Employees draw against earned-but-unpaid salary; the advance (+fee) is disbursed
via the existing pool payout rail and then **netted out of a later salary
payout** and marked repaid. Built on the #133 compensation model; supplies the
"payroll cycle" the repayment settles against via a per-employee **pay-salary**
action (a full multi-employee payroll run remains future work).

- **Models** (`prisma/schema.prisma`, migration `add_salary_advance`, additive):
  `AdvancePolicy` (per-tenant `maxPercentAccrued`, `perCycleCap`, `feePercent`,
  `autoApproveUnder`) and `SalaryAdvance` (amount/fee/`outstanding`, status,
  disbursement + repayment payment refs). Enum `AdvanceStatus`. Tenant-scoped via
  `DIRECT_TENANT_MODELS`.
- **Library** — `lib/hr/advances.ts`: accrual-based `computeEligibility`
  (monthly base pro-rated to date × policy − outstanding), `requestAdvance`
  (auto-approves under the policy threshold, charges the fee), a **guarded**
  lifecycle (approve/disburse are `updateMany` compare-and-sets so a money
  movement can't double-run), and `computeSalaryPayout` + `settleAdvancesForPayout`
  (nets the deduction **FIFO** across outstanding advances, partial/multi-cycle
  supported, marks each REPAID as its balance clears). All `forTenant()`-scoped.
- **API** (ADMIN mutations, CSRF; session reads; payout routes guard on
  `ENABLE_POOL_RAIL`): `GET/POST /api/hr/advances`,
  `POST /api/hr/advances/[id]/approve` (approves + pays the principal via
  `createPoolBatch`), `POST /api/hr/advances/[id]/reject`,
  `GET /api/hr/employees/[id]/advance-eligibility`,
  `POST /api/hr/employees/[id]/pay-salary` (pays net, then settles advances),
  `GET/POST /api/hr/advance-policy`.
- **UI** — an advance panel on the employee detail page: eligibility summary,
  request advance, approve-&-pay / reject, and a **Run salary payout** action
  that nets outstanding advances.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; `pnpm test`
511 pass / 1 skip. New tests cover policy, pro-rata eligibility, over-limit +
auto-approve, guarded transitions, reject-clears-outstanding, full and **partial
FIFO** repayment netting, and tenant isolation.

_Note:_ payout reuses the pool rail (XLM); large nominal salaries are subject to
the rail's per-payout testnet cap. Multi-employee automated payroll runs and
non-XLM currency handling are follow-ups.

## Convert non-monetary package items into withdrawable money — #135

Liquidates the convertible portion of a compensation package item (from #133)
into a cash payout via the existing pool payout rail. Closes the loop:
onboarding *defines* package items; this *cashes out* the convertible ones.

- **Models** (`prisma/schema.prisma`, migration `add_package_conversion`,
  additive): `ConversionPolicy` (per-tenant `ratePercent` haircut, `feePercent`,
  `perConversionCap`), `PackageConversion` (notional/cash/fee, status, linked
  payout `paymentId`), and `PackageItem.convertedValue` tracking the cumulative
  converted notional (remaining = `notionalValue − convertedValue`). Enum
  `ConversionStatus`. Tenant-scoped via `DIRECT_TENANT_MODELS`.
- **Library** — `lib/hr/conversions.ts`: deterministic `valuation` (notional ×
  rate − fee, rounded down to 7 dp), policy get/set, `listConvertibleItems`
  (remaining balance + estimated cash), and a lifecycle that **reserves the
  balance at request** (increments `convertedValue` in a transaction so
  concurrent requests can't over-convert) — `requestConversion` →
  `approveConversion` → `markConversionDisbursed`, with `rejectConversion`
  releasing the reservation. All `forTenant()`-scoped.
- **API** (ADMIN mutations, CSRF; session reads): `GET/POST /api/hr/conversions`,
  `POST /api/hr/conversions/[id]/approve` (approves **and** pays out the net cash
  via `createPoolBatch`, then marks disbursed), `POST /api/hr/conversions/[id]/reject`,
  `GET /api/hr/employees/[id]/convertible`, `GET/POST /api/hr/conversion-policy`.
- **UI** — a conversions panel on the employee detail page: convertible items
  with remaining balance + estimated cash and a convert-&-withdraw action, plus
  a conversions table with approve-&-pay / reject.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; `pnpm test`
495 pass / 1 skip. New tests cover valuation math, policy upsert, balance
reservation + over-convert refusal, non-convertible refusal, reject-releases-
balance, approve→disburse lifecycle, tenant isolation, and route ADMIN-gating.

_Note:_ the payout reuses the pool rail (`createPoolBatch`), so net cash is paid
in XLM; large notionals are subject to the rail's per-payout testnet cap.

## Employee onboarding: roles, salary, compensation packages — #133

The durable HR data foundation that payroll, salary advance (#134), and
non-monetary → cash conversion (#135) read from. An ADMIN can onboard an
employee with a role, base salary, and non-monetary package items; package
changes are **effective-dated** (a new version supersedes the prior, which is
retained as auditable history).

- **Models** (`prisma/schema.prisma`, migration `add_employee_onboarding`):
  `EmployeeRole`, `Employee` (optionally linked to a `Receiver`),
  `CompensationPackage` (effective-dated; `supersededAt`), `PackageItem`
  (monetary `amount`/`currency` or non-monetary `notionalValue`, `cadence`, and
  a `convertible` flag that feeds #135). Enums `EmploymentStatus`,
  `PackageItemType`, `PayCadence`. All tenant-scoped via a direct `tenantId`
  and registered in `DIRECT_TENANT_MODELS` (`lib/db.ts`).
- **Library** — `lib/hr/employees.ts`: Zod-validated `createRole` / `listRoles`,
  `onboardEmployee` (employee + initial package + items in one create),
  `listEmployees` / `getEmployee` (current package + full history), and
  `setPackage` (supersede-then-create versioning). All `forTenant()`-scoped.
- **API** (ADMIN for mutations, session for reads; CSRF-checked):
  `GET/POST /api/hr/employees`, `GET /api/hr/employees/[id]`,
  `POST /api/hr/employees/[id]/package`, `GET/POST /api/hr/roles`.
- **UI** — `/employees` (list), `/employees/new` (onboard form with a package
  builder for monetary + non-monetary items), `/employees/[id]` (detail with
  current package + effective-dated history). New ADMIN "Employees" nav item.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; `pnpm test`
480 (479 pass, 1 skip). New tests cover onboarding (role + salary + non-monetary
item), effective-dated versioning retaining the prior package, cross-tenant
isolation, and route ADMIN-gating. Browser-verified end-to-end (onboard →
persisted → appears in the tenant-scoped list).

## Verifiable Disclosure Link — no-login, live-verifying auditor proof — #128

The external half of R2 (#101) / R4 (#103): those produce documents the tenant
downloads and hands over; this produces a **live, independently-verifiable link**
an outsider opens with no login and re-verifies against testnet. Closes the
"tokenized read-only link" R4 explicitly deferred (now that the app is deployed).

- **Token model** — new `DisclosureLink` (`prisma/schema.prisma`, migration
  `add_disclosure_link`): one active link per payment, persisting only
  `sha256(rawToken)` (raw token lives in the shared URL, never in the DB), with
  `expiresAt` + `revokedAt`. Registered in `DIRECT_TENANT_MODELS` (`lib/db.ts`).
- **Library** — `lib/reports/disclosure-link.ts`: `createDisclosureLink`
  (mint/rotate; reuses `buildAttestation` to enforce tenant-ownership + SETTLED
  before minting), `resolveDisclosureLink` (public; returns the R4 attestation or
  a uniform `invalid`), `verifyDisclosureOnChain` (loads the tenant view key,
  runs the real Groth16/Soroban check, zeroizes), `revokeDisclosureLink`.
- **Mint/revoke API** — `POST`/`DELETE /api/payments/[id]/disclosure-link`
  (ADMIN + CSRF); the raw token is returned once.
- **Public page** — `app/verify/[token]/page.tsx` (no session, `noindex`) renders
  only that one payment's attestation + issuer-signature validity, with a
  "Verify on-chain" button (`VerifyOnChain.tsx` → `POST /api/verify/[token]`,
  rate-limited per IP). Expired/revoked/unknown tokens all render an identical
  safe "link is no longer valid" state.
- **UI** — "Share verifiable link" on the settled-payment detail
  (`components/payments/ShareDisclosureButton.tsx`).
- **Auditable** — every issue/view/verify/revoke writes an `AuditLog` row.
- **Middleware** — `/verify/*` + `/api/verify/*` added to the public allowlist
  (they authenticate by URL token in-handler).

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` green; new tests
cover token mint→resolve, expired/revoked/unknown refusal, cross-tenant and
non-settled mint refusal, audit rows, and route ADMIN-gating.

## Email claim details to off-platform receivers — #81

Follow-up to batch epic **#80** and sibling to the in-app notification (**#82**).
When a batch row has an email but no matching Trexure account, the send now
**emails that receiver an auth-gated claim link** — never the raw bearer note.

- **Delivery model (safe link, not the note)** — the email carries only the
  amount, payer, and a one-time link to `/claim/access?t=<token>`. At send time
  the note is stored in a new **`ClaimLink`** row **encrypted under a key derived
  from the raw token** (only its sha256 is persisted); a DB read alone can't
  recover the note. Reveal is gated twice: the caller must hold the token (from
  the email) AND be an authenticated receiver. Links expire in 14 days. Migration
  `add_claim_link`.
- **Provider seam** — `lib/email/{provider,mock,templates}.ts` mirror the anchor
  `mock|real` toggle via `EMAIL_PROVIDER` (default `mock` → logs, keeps CI
  offline; `resend` is a NotImplemented stub until a real client is wired).
  `EMAIL_FROM` also defaulted, so no new env var is required.
- **Routing (finalizes #82's decision)** — on-platform (email matches a
  `Receiver`) → in-app notification; off-platform (email, no account) → this
  email. A receiver is never both notified in-app and emailed. Per-row
  `notifiedInApp` / `emailedClaim` flags surface in the payer batch UI.
- **Login round-trip fixes** — the emailed link lands on a receiver-gated page,
  so two gaps had to be closed for it to work: middleware now preserves the full
  **path + query** in `next` (the token survives login), and the receiver login
  now honors a sanitized `next` (open-redirect–guarded, confined to `/claim…`)
  instead of always dropping the user on `/claim`.
- **Landing** — `/claim/access` reveals the note behind `requireReceiver` and
  pre-fills the claim form (`ClaimForm` gained an `initialNote`); an
  invalid/expired/tampered token shows a friendly dead-end, never a 500.

Tests: DB-backed `claim-link.test.ts` (encrypt-at-rest, reveal round-trip,
unknown/tampered/expired → null, email send status), extended `batch.test.ts`
(off-platform emailed / on-platform not / none), `safe-next.test.ts` (open-redirect
guard), `email/provider.test.ts`, jsdom `ClaimForm` prefill, and a middleware case
for the `next` token-preservation. `pnpm typecheck` / `lint` / `build` green;
verified live end-to-end (unauth link → login `next` carries the token → authenticated
reveal pre-fills the note; bogus token → dead-end).

---

## In-app claim notification for on-platform receivers — #82

Follow-up to the batch-payments epic **#80**. When a batch row's email matches an
existing Trexure **Receiver** account, the disbursement now surfaces in that
receiver's in-app inbox on login instead of relying solely on an out-of-band note.

- **`Notification` model** (new) — links a global `Receiver` to a disbursement
  `Payment`, with `readAt` / `claimedAt` and a `@@unique([receiverId, paymentId])`
  so send-time creation is idempotent on retry. Not tenant-scoped (mirrors
  `Receiver`/`ReceiverSession`), so it's reached via plain `prisma`. Migration
  `add_notification_model`.
- **Send-time match** — `createPoolBatch` (#84) now matches each row's email
  (case-insensitive) to a `Receiver`; on a hit it creates the notification and
  reports `notifiedInApp: true` on that row. Never throws — a notification hiccup
  can't fail an already-persisted disbursement.
- **Receiver inbox** — `lib/receiver/notifications.ts` (list / unread-count /
  mark-all-read / mark-claimed), a new `/claim/inbox` page (receiver-session gated
  by middleware like the rest of `/claim/*`), an unread badge + Inbox link on the
  claim page, and a `NotificationItem` component.
- **Claim clears it** — `submitClaim` marks the disbursement's notification(s)
  `claimedAt` + `readAt` on a successful claim (best-effort), so the badge drops
  and the inbox shows "Claimed".
- **Privacy** — a notification references the disbursement only (payer, amount,
  status). The bearer note is never persisted anywhere, so it is never in a
  notification; the receiver still supplies the privately-delivered note to claim.
- **Routing decision (with #81)** — on-platform (email matches a `Receiver`) →
  in-app notification (this issue). Off-platform (no match) → email delivery, the
  **#81** follow-up. `notifiedInApp` on the batch result is the signal #81 will use
  to decide who still needs an email, so a receiver isn't double-notified.

Tests: DB-backed `notifications.test.ts` (idempotent create, list, unread count,
mark-all-read, mark-claimed), extended `batch.test.ts` (on-platform match notifies,
off-platform / no-email don't), extended `claim.test.ts` (claim clears the
notification), and jsdom `NotificationItem.test.tsx`. `pnpm typecheck` / `lint` /
`build` green; verified live on a fresh dev server (inbox renders the notification,
badge shows unread, claiming flips it to "Claimed").

---

## UI/UX: consistent logo, mobile-responsive shell, logout — #115

Three shell/branding fixes for the demo/first-run experience.

- **Consistent logo** — a shared presentational `components/ui/Logo.tsx` (brand
  mark + optional wordmark) is now the single source of truth, used by the tenant
  Sidebar, the login/signup pages, and the receiver claim shell (previously only
  the Sidebar showed a logo; auth/receiver were text-only). Favicon set via
  `metadata.icons` → `/logo.png` in the root layout.
- **Mobile-responsive tenant shell** — new `components/shell/AppShell.tsx` client
  wrapper. Desktop (md+) keeps the original static Sidebar; below md it collapses
  into a hamburger-triggered off-canvas drawer with a backdrop + a compact top bar
  carrying the logo. The drawer closes on backdrop tap, on its X button, when a nav
  link is followed (`onNavigate`), and on any route change (render-time
  previous-value comparison — no effect, so no `set-state-in-effect` lint churn).
  `app/(app)/layout.tsx` now renders `<AppShell>`.
- **Tenant logout** — the Sidebar footer gained a logout control wired to a new
  `app/(app)/actions.ts` `logoutAction` server action (mirrors the existing
  receiver `receiverLogoutAction`): clears the session cookie + DB row via
  `destroySession()` then redirects to `/login`. Works without JS (`<form action>`).
  The receiver interface already had its own logout.

Tests: `components/ui/__tests__/Logo.test.tsx` (mark/wordmark/alt), extended
`Sidebar.test.tsx` (logout control present only with an action; close button only
with `onClose`), `AppShell.test.tsx` (drawer opens on the menu button, closes on the
backdrop). `pnpm typecheck` / `lint` / `build` green.

---

## Reset DB + rich demo seed — #107

A one-command database reset + a deterministic, offline, **rich demo seed** so
every screen looks real in a demo (payments across both rails + all states, a
batch with claimed/unclaimed receivers, a populated reconciliation report, view-key
decrypt, receiver logins). Previously `prisma/seed.ts` created a single sample
payment.

- **`pnpm db:reset`** (`scripts/db-reset.mjs`) — drops → re-migrates → reseeds
  (`prisma migrate reset --force` runs the seed). **Guarded**: refuses when
  `NODE_ENV=production` unless `ALLOW_DB_RESET=true` / `--force`; loudly logs the
  masked target + env.
- **Rich seed** (`prisma/seed.ts`, extended) — **deterministic** (fixed IDs + a
  fixed clock via `SEED_BASE_DATE`, default `2026-07-08`, never `Date.now()`;
  createdAt spread across ~40 days) and **idempotent** (demo rows are marked with
  an `intent_demo_` prefix / `DEMO_BATCH_ID` / `ip="seed-script"` and deleted →
  recreated each run — the Demo Replay sample `intent_seed_demo_` is untouched) and
  **offline** (plausible sha256 tx hashes + bank refs as data; no live testnet).
  Seeds a **MEMBER** user + **3 receiver personas** (argon2id logins), **14
  payments across every `PaymentStatus` and both rails** each with matching legs +
  a shape-correct `Receipt` (fiat `buildReceipt` shape vs. `pool-wallet` shape),
  including the reconciliation exceptions (drift, funds-in-custody, pending,
  reconciling, draft), a **`PaymentBatch`** of 5 (3 claimed / 2 unclaimed), and
  **AuditLog** rows. Every payment is shielded under the tenant view key so
  `/decrypt` round-trips.
- **`docs/demo/demo-credentials.md`** — documented logins (admin / member / 3
  receivers); plaintext only in the seed log + this doc, never in the DB.

**Verification:** `pnpm typecheck` / `lint` / `build` green. Seed runs clean on the
dev DB and is idempotent (re-run → identical counts, no duplicate-key errors).
Live-verified the seeded data reads end-to-end: reconciliation statement (settled +
all six exception reason types incl. drift + funds-in-custody + non-zero PHP/XLM
totals), payroll register (batch 3 claimed / 2 unclaimed), **view-key decrypt
round-trip**, receiver argon2 login, and audit rows. The `db:reset` production
guard refuses (exit 1) and `ALLOW_DB_RESET=true` overrides.

## Reporting R5: FX Realized Gain/Loss & Fees Summary — #104 (epic #98, final phase)

The treasury/tax view and the **last phase of the corporate reporting epic
(#98)**: for a period, over every settled payment that off-ramped to fiat, what
rate it realized, the spread vs. the intent-time quote, and the fees — with
per-corridor aggregates for cost tracking and realized-FX tax. Reuses R1's
`lib/reports/**` foundation.

- **The summary** (`lib/reports/fx.ts`) — `buildFxSummary(tenantId, range)`,
  tenant-isolated via `forTenant`. Scoped to **settled payments with a FIAT leg**
  (POOL_BANK / anchor payouts); pool-wallet XLM→XLM settlements are excluded (no
  FX). All figures **read from the stored fiat `Receipt.json`** (destination
  amount, realized `fx.rate`, `fees`, `slippage`) — never recomputed — with the
  intent-time quote (`Payment.targetAmount`) as the reference. Per payment:
  realized amount/rate, reference amount/rate, **realized gain/loss** (realized −
  reference), anchor + network fees (numeric, parsed from the formatted receipt
  fee strings), slippage, tx + bank refs. **Aggregates per corridor**: totals
  (source, realized, reference, fees), **weighted-average realized + reference
  rate**, and total realized gain/loss. `fxSummaryToCsv` / `fxSummaryToPdf` render
  it.
- **`/reports/fx` UI** — **ADMIN-only** (treasury/tax data; `role !== "ADMIN"` →
  `notFound()`), date-range picker, per-corridor aggregate + per-payment tables
  (gain/loss colored), and CSV / PDF download. Gated card on `/reports`.
- **API** `GET /api/reports/fx?from&to&format=csv|pdf` — `requireAdmin` (403/401),
  tenant-scoped, audit-logs every generation (`report.generate`, `report:fx`),
  streams the file.

**Verification:** 10 tests — a DB-backed builder test (reads realized figures
from the stored receipt; **gain vs. loss** vs. the intent quote; per-corridor
aggregation incl. **weighted-average rate** and total gain/loss; excludes
pool-wallet / pending / out-of-range / other tenants; **zero-fiat period without
dividing by zero**), a CSV snapshot, and route RBAC/audit/streaming tests. `pnpm
typecheck` / `lint` / `build` green (`/reports/fx`, `/api/reports/fx` registered).
Live-verified end-to-end against the dev DB: 2 fiat off-ramps (a +6 gain and a −3
loss) → correct per-payment rows, aggregate totals (weighted-avg 6.26, total G/L
+3, fees 75), valid PDF + CSV, and a clean zero-fiat period.

## Reporting R4: Proof-of-Payment Attestation — #103 (epic #98)

A single shareable, tamper-evident document a company sends a vendor (or keeps
for its records) as evidence that **one specific payment happened and settled** —
without exposing the rest of the ledger. "Signed proof of payment", not the full
R2 disclosure pack. Reuses R1's `lib/reports/**` foundation.

- **The attestation** (`lib/reports/attestation.ts`) — `buildAttestation(tenantId,
  paymentId)`, tenant-isolated via `forTenant`. Only issued for a **SETTLED**
  payment the tenant owns (else `AppError` 409 / 404). Assembled entirely from the
  already-stored `Receipt.json` + settlement legs (both the fiat `buildReceipt` and
  on-chain-only `pool-wallet` shapes), so it never re-derives figures: date,
  amounts/corridor/FX, on-chain tx + `proofHash` (with stellar.expert link),
  settlement legs, bank ref, receipt id.
- **Verifiability, two ways** — (1) **third-party**: the on-chain tx + proofHash a
  vendor can independently confirm on-chain; (2) **issuer tamper-evidence**: an
  **HMAC-SHA256 over the immutable payment facts** (excludes `issuedAt` so the
  signature is stable across re-downloads), keyed by a signing key **derived from
  `MASTER_ENCRYPTION_KEY`** (domain-separated — the raw master key is never used to
  sign; no new env var). `verifyAttestation()` recomputes and constant-time
  compares. A public *asymmetric* signature is intentionally out of scope for this
  release (noted on the document).
- **Shareable** — a self-contained **PDF** (`attestationToPdf` via the R1
  `renderReportPdf`) plus a machine-readable **JSON** (`attestationToJson`) a
  verifier can script against.
- **API** `GET /api/reports/attestation?paymentId&format=pdf|json` —
  `requireSession` (**ADMIN or MEMBER** — it's the tenant's own payment),
  tenant-isolated, audit-logged (`report.generate`, `report:attestation`), streams
  the file. Only the one payment is exposed — no ledger leakage.
- **UI** — a "Proof of payment (PDF)" + JSON download on the **payment detail
  page** for settled payments, plus a card on `/reports` linking to settled
  payments.

**Verification:** 12 tests — a DB-backed builder test (fiat + on-chain-only
pool-wallet attestation content matches the stored receipt/legs; **HMAC
sign/verify roundtrip + tamper detection**; `issuedAt` not signed;
non-settled → 409, cross-tenant/unknown → 404; JSON + `%PDF` render) and route
auth/validation/streaming/audit tests. `pnpm typecheck` / `lint` / `build` green
(`/api/reports/attestation` registered). Live-verified end-to-end against the dev
DB: a settled fiat payment → attestation with correct amounts + on-chain proof,
signature verifies, a tampered amount fails, a re-issued `issuedAt` still
verifies, valid PDF + JSON, and 409/404 refusals.

## Reporting R3: Disbursement / Payroll Register — #102 (epic #98)

The register a finance/HR team keeps for batch payroll (#80): who was paid, how
much, by which rail, and — the actionable bit — **whether each freelancer has
claimed**. Reuses R1's `lib/reports/**` foundation.

- **The register** (`lib/reports/payroll.ts`) — `buildPayrollRegister(tenantId,
  { batchId? | range? })`, tenant-scoped by an explicit `tenantId` filter. Scoped
  to **one `PaymentBatch`** (from the batch UI) or a **date range across batches**
  (from `/reports`, on `PaymentBatch.createdAt`). One row per child `Payment`:
  receiver (`recipientRef`), amount, `payoutMethod` (wallet/bank), status, **claim
  state** (SETTLED→`claimed`, FAILED→`failed`, else→`unclaimed`), claim
  destination (bank ref for POOL_BANK; "on-chain wallet" for a settled wallet
  claim — the address lives in the withdraw tx), deposit commitment, withdraw tx,
  and receipt id (from `Receipt.json.id`, matching R1/R2). **Roll-up** per batch +
  overall: claimed / unclaimed / failed counts and per-symbol totals (all +
  claimed-only). `payrollRegisterToCsv` / `payrollRegisterToPdf` render it.
- **`/reports/payroll` UI** — **ADMIN-only** (`role !== "ADMIN"` → `notFound()`),
  batch-scoped (`?batchId=`) or date-range mode, with a stat row
  (disbursements / claimed / unclaimed / failed), a disbursements table, and CSV /
  PDF download. Discoverable via a card on `/reports` **and** an ADMIN-only
  "Payroll register" link on the batch detail page (`/pool/batches/[id]`).
- **API** `GET /api/reports/payroll?batchId&from&to&format=csv|pdf` —
  `requireAdmin` (403/401), tenant-scoped, audit-logs every generation
  (`recordAudit({ action: "report.generate", metadata: { report: "payroll" } })`),
  streams the file as an attachment. A `batchId` scope ignores the date range.

**Verification:** 11 tests — a DB-backed register test (a batch with mixed
statuses → correct rows / destinations / receipt ids + claimed/unclaimed/failed
roll-up + per-symbol totals; out-of-range + cross-tenant exclusion; a
cross-tenant batch id returns empty), a CSV snapshot, and route
RBAC/scope/audit/streaming tests. `pnpm typecheck` / `lint` / `build` green
(`/reports/payroll`, `/api/reports/payroll` registered). Live-verified end-to-end
against the dev DB: a 3-receiver batch (2 claimed / 1 unclaimed) with wallet +
bank destinations, correct totals, and a valid PDF + CSV; range-mode across
batches confirmed.

## Reporting R2: Compliance & Audit Disclosure Pack — #101 (epic #98)

The report **only Trexure can produce**: a period (and optionally
single-counterparty) package a company hands to its external auditor, the BIR, or
AMLC that proves each payment is real, settled, and to whom — revealed **only via
the tenant's view key** — while the public ledger stays shielded. Reuses R1's
`lib/reports/**` foundation.

- **The Disclosure Pack** (`lib/reports/disclosure.ts`) —
  `buildDisclosurePack(tenantId, range, { counterparty?, actorUserId })` reads
  through `forTenant()` (tenant-isolated) and, per payment, assembles:
  - **Decrypted details** — `sender`/`recipient`/`asset`/`amount`/`targetCurrency`
    /`memo` revealed by decrypting `encryptedPayload` with the tenant view key
    (`loadViewKey` + `decryptWithViewKey`, the same path as
    `app/api/payments/[id]/decrypt`). The key is loaded **lazily** (only when the
    period has something shielded), used in-process, and **zeroized in a `finally`**;
    it is never returned or logged. Non-shielded / undecryptable payments are still
    listed with `disclosed: null` + a note.
  - **Proof it happened** — the on-chain tx hash + `proofHash` (ZK commitment) with
    a stellar.expert link an auditor can verify independently.
  - **Proof it settled** — both legs (ONCHAIN + FIAT) with statuses, realized FX,
    and bank ref; the receipt id (pulled from the stored `Receipt.json`).
- **Self-auditing disclosure** — every reveal writes a `viewkey.decrypt` AuditLog
  row (payment as target) and the pack writes one `report.disclosure` row, so a
  regulator can see exactly what was revealed, by whom, and when.
- **Renderers** — a signed-looking **PDF** (`disclosurePackToPdf`: cover summary
  with tenant/period/counterparty/generated-by/count + verification note, then a
  disclosed-details table and a proof-of-settlement table) plus machine-readable
  **CSV** (`disclosurePackToCsv`) and **JSON** (`disclosurePackToJson`) appendices
  auditors can script against — all via R1's `csv`/`pdf` foundation.
- **`/reports/disclosure` UI** — an **ADMIN-only** page (decrypting is the most
  sensitive action in the app; a non-admin gets `notFound()`) with a
  period + counterparty picker, a **non-decrypting scope preview**
  (`previewDisclosureScope` — counts + opaque counterparty refs, **no reveal, no
  audit**), and Generate PDF / CSV / JSON buttons. Discoverable via a card on
  `/reports`.
- **API** `GET /api/reports/disclosure?from&to&counterparty&format=pdf|csv|json`
  — `requireAdmin` (403/401 otherwise), tenant-scoped, streams the file as an
  attachment. The decryption + audit logging live in the builder, so the route
  only gates, generates, and streams.

**Verification:** 16 tests — a DB-backed `disclosure` test (real view-key
encrypt/decrypt round-trip, reveal correctness, non-shielded handling, tenant
isolation incl. a same-`recipientRef` other-tenant decoy, counterparty filter,
audit-row counts, non-auditing preview, CSV/JSON renderers) + route
RBAC/streaming/format/actor tests. `pnpm typecheck` / `lint` / `build` green
(`/reports/disclosure`, `/api/reports/disclosure` registered). Live-verified
end-to-end against the dev DB: a shielded payment revealed under the view key,
on-chain proof + explorer link, both settlement legs + FX + bank ref, both audit
rows written, and a valid PDF + CSV + JSON pack rendered.

## Reporting R1: Reconciliation / Settlement Statement (+ reporting foundation) — #100 (epic #98)

The month-end finance export — every settled payment for a period plus the
exceptions finance chases — and the **reusable reporting foundation** the rest of
the corporate-reporting epic (#98, R2–R5) builds on.

- **Foundation `lib/reports/**`** (report-agnostic, reused by R2–R5):
  - `scope.ts` — period date-range parsing/scoping (`parseDateRange`,
    `currentMonthRange`, inclusive end-of-day, reversed-range swap; keyed on
    `Payment.createdAt`). Pure — testable without the DB.
  - `csv.ts` — a generic RFC-4180 CSV serializer (`toCsv`, `csvRow`,
    `joinCsvBlocks`; quotes/commas/newlines escaped, CRLF rows). Greenfield —
    no CSV utility existed.
  - `pdf.ts` — a generic report PDF renderer (`renderReportPdf`) modeled on
    `lib/pdf/receipt.ts` (pdfkit core fonts, title + summary grid + paginated
    tables), landscape A4.
- **The Reconciliation Statement** (`lib/reports/reconciliation.ts`) —
  `buildReconciliationStatement(tenantId, range)` reads through `forTenant()`
  (tenant-isolated) and splits the period into **settled rows** (date,
  counterparty, corridor, source/target amounts, FX, fees, slippage, on-chain
  tx, bank ref, receipt id) and an **exceptions list** (in-flight
  PENDING/ONCHAIN_CONFIRMED/RECONCILING, FAILED incl. bank-claim
  **funds-in-custody**, and **on-chain-leg-without-fiat drift**), plus **totals**
  (settled count + sums per source asset / target currency). Figures are pulled
  from the stored `Receipt.json` when present (both the fiat `buildReceipt` and
  the on-chain-only `pool-wallet` shapes) so the statement **never re-derives and
  therefore never drifts** from the receipt the customer holds; it falls back to
  the `Payment` columns otherwise. `reconciliationToCsv` / `reconciliationToPdf`
  render it.
- **`/reports` UI** (`app/(app)/reports`) — an **ADMIN-only** area (reports are
  sensitive financial data; a non-admin gets `notFound()`, matching the pool
  rail's gating) with a date-range picker, live server-rendered preview
  (settled + exceptions tables, per-currency stat cards), and **CSV / PDF
  download** buttons. A gated **Reports** sidebar link (ADMIN only).
- **API** `GET /api/reports/reconciliation?from&to&format=csv|pdf` — `requireAdmin`
  (403 otherwise), tenant-scoped, streams the file as an attachment, and
  **audit-logs every generation** (`recordAudit({ action: "report.generate" })`).

**Verification:** 32 tests — pure `csv`/`scope` units, a DB-backed
`reconciliation` test (tenant isolation, settled/exceptions split, stored-receipt
figures, pool-wallet + funds-in-custody handling, totals), a CSV snapshot, a PDF
smoke test, route RBAC/audit/streaming, and Sidebar link visibility.
`pnpm typecheck` / `lint` / `build` green (`/reports`, `/api/reports/reconciliation`
registered). Live-verified against the dev DB: 4 settled / 4 exceptions with
real stored-receipt figures, drift detected on a real ONCHAIN_CONFIRMED payment,
CSV + valid PDF rendered.

## Batch payments P6: end-to-end payment-details UI — #88 (closes epic #80)

The demonstrable end-to-end view and the **final phase of the batch epic (#80)**:
from a batch send, through on-chain receive + reconciliation, to a Stripe-like
receipt — one screen a judge can follow, for both wallet (P4) and bank (P5) claims.

- **Batch overview** `app/(app)/pool/batches` — every `PaymentBatch` for the
  tenant with a live per-status **roll-up** (PENDING / ONCHAIN_CONFIRMED /
  RECONCILING / SETTLED / FAILED), totals, and created-by; drills into a batch
  detail listing each child disbursement, which links to its payment detail.
  New read model `lib/pool/batch-data.ts` (`listPoolBatches` / `getPoolBatchDetail`,
  tenant-scoped by explicit `tenantId`).
- **Per-payment detail** `app/(app)/pool/batches/[id]/[paymentId]` — a dedicated,
  self-contained surface (the fiat `PaymentLifecycle`/`ReceiptPanel` are coupled to
  the fiat receipt shape and would break on the on-chain-only pool receipt):
  - **Timeline** (`components/pool/Timeline.tsx`) PENDING → ONCHAIN_CONFIRMED →
    RECONCILING → SETTLED (+ FAILED).
  - **Legs** (ONCHAIN + FIAT) with stellar.expert tx links, bank ref, amounts.
  - **View-key decrypt** — reuses `POST /api/payments/[id]/decrypt`. Made possible
    by shielding batch disbursements at send time: `lib/pool/batch.ts` now encrypts
    `{sender, recipient, asset, amount}` under the tenant view key (the canonical
    enclave payload shape), so the payer can selectively reveal receiver details
    (the accountant story). Guarded — a tenant without a view key skips shielding.
  - **Receipt** (`components/pool/PoolReceiptCard.tsx`) — renders BOTH the
    on-chain-only wallet receipt and the full fiat receipt (defensive field reads);
    **PDF export** reuses `POST /api/payments/[id]/receipt/pdf`.
- **Navigation** — a gated **Batch payments** sidebar link; the batch-send results
  now link straight to the batch overview.
- **Tests** — `PoolReceiptCard.test.tsx` (jsdom: both receipt shapes + timeline
  step/failed states), `batch-data.test.ts` (DB-backed roll-up + cross-tenant
  isolation). typecheck/lint/build green. Verified **live**: batch of 2 (shielded)
  → decrypt reveals the receiver → wallet claim (`9806a2c9…`) → roll-up `SETTLED 1 /
  PENDING 1`, settled child carries a receipt.

**Epic #80 complete** (P1 schema → P2 batch send → P3 receiver persona → P4 wallet
claim → P5 bank claim → P6 end-to-end UI): a payer sends one private batch to many
freelancers, each gets a claimable note, receivers claim to a wallet or PH bank
through a separate interface, the bank path reconciles to a Stripe-style receipt,
and the whole journey is demonstrable in the app. [[trexure-real-zk]]

## Batch payments P5: bank claim path — mock PDAX off-ramp → reconcile → receipt — #87

The loop-closer (epic #80): a receiver claims a note to a **PH bank account**. The
pool `withdraw` moves XLM into custody (ONCHAIN leg); a **mock PDAX off-ramp**
sells XLM→PHP and pays the bank (FIAT leg); the two legs **reconcile by `intentId`**
into a `SETTLED` payment + a Stripe-style receipt with the fiat block. Fills the P3
`claimToBank` stub; wires the pool rail into the existing reconcile/receipt spine.

- **`lib/receiver/claim.ts#claimToBank`** — looks up the disbursement `Payment` by
  the note's `poolCommitment`, runs the real ZK `createPoolWithdraw` into a
  **custody address** (the server/relayer account), then in one transaction writes
  the `ONCHAIN` leg + `poolNullifierHash`/`receiverId` and finalizes the corridor as
  fiat: `payoutMethod=POOL_BANK`, `corridorTo=PHP`, `targetAmount` = quoted PHP,
  status `ONCHAIN_CONFIRMED`.
- **Mock off-ramp** — drives the existing `lib/anchor/mock.ts#triggerMockPayout`,
  which POSTs the **real signed fiat webhook** (`/api/webhooks/fiat`, HMAC-verified,
  same seam as real PDAX #69) carrying the same `intentId` → writes the `FIAT` leg
  with the realized PHP amount + `bankRef`.
- **Reconcile** — the existing `lib/reconcile/matcher.ts#tryReconcile` matches
  ONCHAIN + FIAT by `intentId` (corridor + 1% FX) → `SETTLED` → `buildReceipt` (the
  fiat receipt, fiat block populated: FX/fees/net + on-chain tx + bank ref). Called
  synchronously in the claim so the receiver gets the receipt in one response
  (idempotent — the webhook also enqueues a worker reconcile).
- **FX** — added `XLM:PHP` (demo 6.24) to `lib/fx.ts` so the quote, target, and
  payout amounts stay coherent (state: `PENDING → ONCHAIN_CONFIRMED → SETTLED`).
- **Failure routing** — the withdraw happens FIRST (funds in custody); if the
  off-ramp then fails, the webhook marks the FIAT leg + payment `FAILED` and the
  claim throws **502** — the XLM sits in custody for a manual refund (real PDAX #69
  would automate the reversal). Documented in code.
- **Tests** — `lib/receiver/claim.test.ts` gains 2 DB-backed bank cases (happy:
  both legs + SETTLED + fiat receipt with bank ref; failure: FAILED + 502, ONCHAIN
  leg still present) with the mock off-ramp writing the FIAT leg (what the webhook
  does). typecheck/lint/build green. Verified **live on testnet**: deposit → bank
  claim withdraw-to-custody (`cbe8b64c…`) → real signed webhook → reconciled
  **SETTLED**, XLM→PHP `12.48 PHP`, fiat receipt with `bankRef`.

## Batch payments P4: wallet claim path (withdraw → settle → on-chain receipt) — #86

The simplest claim path (epic #80): a receiver claims a note straight to a
**crypto wallet**. The pool `withdraw` **is** settlement (Rail A — no two-leg
fiat match), so this path settles on tx confirm and emits an on-chain-only
receipt. Fills the P3 `claimToWallet` stub.

- **`lib/receiver/claim.ts#claimToWallet`** — looks up the disbursement `Payment`
  by the note's public `poolCommitment` (`0x`+32-byte hex), runs the real ZK
  `createPoolWithdraw` to the receiver's address, then in one transaction writes
  the `ONCHAIN` `PaymentLeg` (CONFIRMED, tx/ledger, mirroring
  `worker/jobs/watch-onchain.ts`), sets `poolNullifierHash`, links `receiverId`,
  and advances the `Payment` to `SETTLED`. **Double-claim** rejected twice over:
  a DB pre-check (`SETTLED`/nullifier already set → 409) and the on-chain spent
  nullifier.
- **On-chain-only receipt** — `lib/reconcile/receipt.ts#buildPoolWalletReceipt`
  (new, alongside the untouched fiat `buildReceipt`): no `fiat` block, no FX/anchor
  fee, `rail: "pool-wallet"`, XLM→XLM. Persisted to `Receipt` and returned to the
  receiver in the claim response; the claim UI shows the settled amount + withdraw
  tx link + "receipt issued".
- **Pool sync fix (`lib/pool/sync.ts`)** — `syncPoolLeaves` now **paginates
  `getEvents` by cursor** until the scan reaches `latest`. The RPC bounds each
  scan to a ~10k-ledger window, so the old single-call sync silently dropped
  recent deposits once the pool had been alive longer than that window — the
  mirror root drifted from on-chain and **every** withdraw failed with "not in
  the pool". This repairs P4 **and** the standalone pool rail (#65) on the
  now-aged demo pool.
- **Tests** — `lib/receiver/claim.test.ts` (DB-backed, mocked withdraw): happy
  path (leg + SETTLED + nullifier + receiver link + on-chain-only receipt shape),
  double-claim 409 without re-withdrawing, unknown-note 404. `pnpm typecheck`/
  `lint`/`build` green. Verified **live on testnet**: batch deposit → wallet claim
  ZK withdraw (`99c5a7d4…`) → SETTLED + receipt, double-claim rejected.

## Batch payments P3: receiver (freelancer) auth + interface + claim form — #85

The receiver-facing side of the batch epic (#80): a **separate login + interface**
where a freelancer claims their pay, fully isolated from the tenant `(app)` shell.
This phase ships the persona's auth, layout, and validated claim **form**; the
actual payout execution is P4 (wallet) / P5 (bank).

- **Receiver auth** (`lib/receiver/**`) — a parallel to `lib/auth/**` for the P1
  global `Receiver` persona: argon2id (reusing `lib/auth/password`), a distinct
  **`__Host-trexure_receiver_session`** cookie + `ReceiverSession` table with the
  same sliding/absolute TTL policy, `registerReceiver`/`verifyReceiverCredentials`
  (email login; duplicate email → 409). CSRF reuses the shared double-submit
  token. Cookie name lives in a dependency-free `lib/receiver/cookie.ts` so the
  edge middleware can import it.
- **Isolation** — `middleware.ts` gains a receiver-area branch: `/claim*` pages
  require the **receiver** session (a tenant `User` session grants nothing → a
  tenant user is bounced to `/claim/login`), and a receiver session grants
  nothing in the tenant app (bounced to `/login`). `/api/claim` defers to its
  handler's `requireReceiver`. Proven by `middleware.test.ts` (both directions).
- **Interface** `app/(receiver)/**` — a distinct minimal shell (NOT the sidebar):
  `/claim/login` (combined log-in / create-account form, one server action
  branching on a hidden `intent`) and `/claim` (the claim form, receiver-gated,
  with a logout button). Both gated by `ENABLE_POOL_RAIL`.
- **Claim form + schema** — note (validated for `NOTE_PREFIX` **and** round-trip
  `parseNote`) + a **discriminated payout choice** (`claimSchema` in
  `lib/validation/pool.ts`): **wallet** (`StrKey` Stellar `G…`) or **bank**
  (bankCode / accountName / accountNumber, mock PDAX until #69). Inline client
  validation; the note is a bearer credential (never logged).
- **P4/P5 boundary** — `POST /api/claim` does auth + CSRF + validation, then
  dispatches to `lib/receiver/claim.ts` stubs that return **501** with a clear
  "wired in P4 (#86)/P5 (#87)" message (the form surfaces it as an informational
  notice). P4/P5 fill `claimToWallet`/`claimToBank`.
- **Tests** — `claim.test.ts` (schema: valid wallet/bank, bad prefix/length,
  non-Stellar address, missing bank field, unknown method), `route.test.ts`
  (flag-off 404, no-receiver 401, CSRF 403, 422, 200 dispatch, 501 boundary),
  middleware isolation (6 cases). Verified **live** (real DB + argon2 + MiMC):
  register → login (correct/wrong) → duplicate 409 → both claim paths hit the
  501 boundary. typecheck/lint/build green.

## Batch payments P2: batch send API + service + payer UI — #84

The payer-side batch flow (epic #80): submit N receivers once → N pool deposits →
N claimable notes, each persisted as a first-class child `Payment` under a
`PaymentBatch`. Builds on P1's schema (#83).

- **Service** `lib/pool/batch.ts#createPoolBatch(tenantId, userId, input)` —
  creates a `PaymentBatch`, then for each row calls `createPoolDeposit`
  (`lib/pool/service.ts`) to mint a note and persists a child `Payment`
  (`payoutMethod=POOL_WALLET`, `status=PENDING`, public `poolCommitment`, XLM→XLM
  corridor, fresh `intentId`). Deposits run **sequentially** so a partial failure
  leaves a clean per-row audit trail; a throwing row is reported `ok:false` and
  **successful notes are preserved**. The batch roll-up (`count`/
  `totalSourceAmount`) is reconciled to the rows that actually landed.
- **Bearer safety** — only the public commitment is persisted; the note is echoed
  **once** in the response and never stored (`encryptedNote` stays null, reserved
  for a later opt-in re-reveal). Everything tenant-scoped via `forTenant()`.
- **API** `POST /api/pool/batch` — session + CSRF, gated behind `ENABLE_POOL_RAIL`
  (404 when off), Zod-validated `{ receivers: [{ amount, ref, email? }] }` (1–50
  rows). Mirrors `/api/pool/deposit`. `email` is captured but unused (#81/#82).
- **Payer UI** `app/(app)/pool/batch` — a multi-row form (add/remove receivers,
  amount + label + optional email) reached via a **Batch send** link on the pool
  page; on submit, a results view lists each receiver's **copy-pasteable claim
  details** (note + claim URL + amount + pool contract id) with a bold
  bearer-credential warning, per-row **Copy note** / **Copy claim details**
  buttons, deposit tx links, and per-row success/failure.
- **Tests** — route tests (flag-off 404, CSRF 403, happy path 201, empty list &
  bad row 422) + a DB-backed service test (batch + N children persisted; partial
  failure preserves successes). Verified **live on testnet**: a 1-receiver batch
  did a real deposit (tx `4a84b0be…`), minted a note, and persisted the child
  `Payment` (POOL_WALLET/PENDING). typecheck/lint/build green.

## Batch payments P1: schema — Receiver persona + PaymentBatch + pool payout fields — #83

Foundation schema for the **batch private payments epic (#80)** — the tables
that let a pool payment become a first-class `Payment` (reconcilable, receiptable)
and give freelancer receivers their own identity. Schema/migration only; the
service, API, and UI land in P2–P6.

- **`Receiver` persona** — a **global** identity (NOT tenant-scoped: any tenant
  can pay any receiver), isolated from the tenant `User`/`Session`. Carries an
  `email` login identity + argon2id `passwordHash`, with its own
  **`ReceiverSession`** table (mirrors `Session`) so the tenant app shell and the
  receiver claim interface never share a session. Chose a separate model over
  `Role.RECEIVER` because receivers aren't tenant members.
- **`PaymentBatch`** — groups the child `Payment`s of one batch-send
  (`tenantId`, `createdByUserId`, `count`, `totalSourceAmount`). Tenant-scoped:
  added to `DIRECT_TENANT_MODELS` in `lib/db.ts` so `forTenant()` forces/filters
  `tenantId` (covered by a new case in `test/tenant-isolation.test.ts`).
- **`Payment` extensions (all optional/additive)** — `batchId?`, `payoutMethod?`
  (`POOL_WALLET | POOL_BANK` enum), `poolCommitment?`, `poolNullifierHash?`,
  `receiverId?`. **No plaintext bearer notes:** only the public
  commitment/nullifierHash are stored; if the note must be re-shown to the payer
  it lands in `encryptedNote`/`noteNonce` (Bytes, view-key encrypted). Indexed on
  `batchId` and `receiverId`; existing fiat/reconcile payments untouched.
- **Migration** `add_batch_payments_receiver_persona` applies cleanly on a fresh
  DB; `prisma generate` + typecheck + lint + `next build` green.

## Shielded pool P6: app rail UI (Private on-chain transfer) — #65

Surfaces the pool as a **new "Private on-chain transfer" rail** in the app,
feature-flagged behind `ENABLE_POOL_RAIL` (default **off**) — the existing
fiat/mock-anchor + reconcile flow is untouched. Final phase of the epic (#59).

- **Flag + gating**: `ENABLE_POOL_RAIL` (default off) + `POOL_CONTRACT_ID`
  (defaults to `zk/pool-deploy.json`) in `lib/env.ts`. When off, `/pool` and
  `/api/pool/*` **404** and the sidebar link is hidden.
- **API** (`app/api/pool/**`, session + CSRF like the payment routes):
  `deposit` (shield XLM → returns the one-time note), `withdraw` (claim a note to
  an address), `demo` (one-click deposit→withdraw to a fresh address). Thin routes
  → `lib/pool/service.ts` (+ `sync.ts` rebuilds the tree from on-chain events,
  `demo.ts` orchestrates the one-click flow).
- **UI** (`app/(app)/pool/`): a gated page with three cards — shield (reveals the
  note once with a save-it warning), claim (note + recipient → withdraw tx), and a
  one-click demo that runs the full flow on-screen and shows both txs + the
  unlinkability note. Sidebar gains a gated "Private Transfer" link.
- **Tests**: deposit + withdraw route tests (flag-off 404, auth/CSRF, happy path,
  invalid note/recipient) + Sidebar link tests. Server-signed for the demo
  (real-wallet signing out of scope; noted in the UI).

Built TDD (46 tests across the rail + lib). The server path (`service`/`sync`/
`demo`) was **verified live on testnet** against the deployed pool
`CB5FU3DB…`. Demo-grade (16-leaf set, demo trusted setup). Completes #59.

## Shielded pool P5: testnet E2E deposit→withdraw demo — #64

Proves the whole pool works **on Soroban testnet with real XLM**, end to end, and
demonstrates the privacy property. The `ShieldedPool` contract (P3, `--features
pool`) was deployed + initialized (depth 4, native XLM SAC) — its first live run,
confirming the depth-4 tree fits Soroban's **real** per-tx budget, not just the SDK
harness.

- `zk/scripts/pool-demo.mjs` + `pnpm pool:demo` — funds a fresh depositor A and
  recipient B (Friendbot), deposits N XLM from A via `lib/pool/deposit.ts`
  (prints the note), rebuilds the tree from on-chain `deposit` events and asserts
  **off-chain root == on-chain `get_root`**, withdraws to B via
  `lib/pool/withdraw.ts` using only the note, then asserts: B received exactly N,
  a replay is rejected (nullifier spent), and the deposit/withdraw are unlinkable
  (A signs the deposit; the server relays the withdraw to B; the withdraw envelope
  never references the deposit or A). Runs headless (`process.exit`), prints
  stellar.expert links.
- `zk/scripts/pool-init.mjs` — one-time `initialize(token, depth, vk)` (the vk is
  a Soroban struct, built by hand in the locked BE / Fp2-c1-first encoding).
- `zk/pool-deploy.json` — deployed `POOL_CONTRACT_ID`, native SAC, depth, deploy
  ledger + tx hashes (the demo reads it).
- `lib/pool/deposit.ts` — `submitDeposit` gained an optional `fromSecret` so the
  demo can deposit from a *fresh* account (faithful unlinkability).

**Verified live on testnet** (10 XLM, depth-4 tree, leaf index 2 of 3):
deposit [`ea37b3b5…`](https://stellar.expert/explorer/testnet/tx/ea37b3b5eab5676cd80842b90e59664b5f56bf1e2207a4cb3e4b6425d3d22024)
→ withdraw [`c7d13eaf…`](https://stellar.expert/explorer/testnet/tx/c7d13eaf3b9a8d7db4ef373a62e2c44ebeb9e3eea488b29925b94ed293f54444).
Pool `CB5FU3DBINAZXGT3KG3BIHXWA4SKN6VQUTJSBRBN4VHQBV2IIE7RLZT4`. Demo-grade
(unaudited, demo trusted setup). Event-sync is bounded by RPC retention (a
production mirror would persist to a DB). **Unblocks P6 (#65, app rail UI).**

## Shielded pool P4: off-chain TS library (`lib/pool/**`) — #63

The TypeScript layer that turns the circuit (P2) + contract (P3, deployable at
depth 4 per P3.5) into usable operations: mint notes, mirror the tree, generate
withdrawal proofs, and submit deposits/withdrawals. Built TDD (32 tests).

- `note.ts` — `generateNote(amount)` mints `{ secret, nullifier }`, derives
  `commitment` + `nullifierHash` (via P1 `mimc.ts`), and serializes a portable
  `trexure-note-v1-<hex>` bearer claim string; `parseNote` round-trips it.
- `tree.ts` — `PoolMerkleTree` (depth 4), an off-chain incremental Merkle mirror
  that **reproduces the on-chain root** (locked by a test asserting the demo
  deposit's root == the committed proof's public root) and builds
  `pathElements`/`pathIndices` for any leaf.
- `proof-encoding.ts` — snarkjs proof → Soroban `withdraw` args (big-endian,
  Fp2 c1-first, A pre-negated); **cross-checked byte-for-byte against the Rust
  contract fixture** (`withdraw_fixture.rs`).
- `withdraw.ts` (server-only) — `buildWithdrawProof` generates the Groth16 proof
  from a note + tree (verified off-chain against `withdraw_vk.json`);
  `submitWithdraw` sends `pool.withdraw`.
- `deposit.ts` (server-only) — `prepareDeposit` mints the note + commitment;
  `submitDeposit` sends the SAC transfer + `pool.deposit`.
- Widened `types/snarkjs.d.ts` so `fullProve` accepts real array circuit signals.

Live on-chain submit (deposit/withdraw) is exercised by **P5** (testnet E2E) — no
Soroban CLI in this env — so P4 validates everything up to `sendTransaction`:
note round-trip, tree↔on-chain-root agreement, and real proof gen→encode→verify.
**Unblocks P5 (#64) / P6 (#65).**

## Shielded pool P3.5: on-chain pool made network-deployable (depth-4 tree) — #74

Resolves the P3 budget blocker: 220-round MiMC over `Fr` costs ~19M CPU per tree
level, so `deposit`/`initialize` (which do `depth` hashes) blew Soroban's 100M
per-tx budget at depth 12. **Measured** the cost by depth and dropped the tree to
**depth 4** (16-leaf anonymity set), where each op ≈ 77M CPU — inside the default
budget with ~22% headroom. Keeps Approach A fully **trustless** (no operator roots).

- `zk/circuits/withdraw.circom` → `Withdraw(4)`; trusted setup regenerated at
  **2^15** ptau (~13.2k constraints). New committed `withdraw.wasm` /
  `withdraw_final.zkey` / `withdraw_vk.json` + proof/public fixtures.
- `zk/verifier/src/withdraw_fixture.rs` regenerated from the real depth-4 proof.
- `zk/verifier/src/pool.rs` — inits at depth 4; new test
  `initialize_and_deposit_fit_default_budget_at_depth_4` asserts each call
  succeeds under `budget().reset_default()` (the real deployability guarantee).
- `docs/zk-mimc.md` — the measured depth→CPU table + resolution supersede the
  old "not deployable" finding. **Unblocks P4 (#63) / P5 (#64) / P6 (#65).**

Still a feature-gated spike (demo-grade trusted setup, unaudited). A larger set
later is a one-line depth bump paired with fewer MiMC rounds or a cheaper hash.

## Shielded pool P3: ShieldedPool Soroban contract — #62

Third slice of the shielded-pool epic (#59): the on-chain contract that
custodies the token, maintains the Merkle tree + nullifier set, and gates
payouts on the P2 ZK proof.

- `zk/verifier/src/pool.rs` — `ShieldedPool`: `initialize` (token/depth/vk +
  precomputed zero subtrees), `deposit` (SAC transfer in + Merkle insert),
  `withdraw` (reuse `groth16::verify` + nullifier check + SAC transfer out),
  `get_root`/`is_spent` views. Root-history ring; persistent nullifier set.
- `zk/verifier/src/mimc.rs` (+ generated `mimc_constants.rs`) — MiMC over BLS12-381
  `Fr` reproducing the P1 golden vectors (Rust cross-check test).
- `zk/verifier/src/groth16.rs` — the pairing verify **extracted from `lib.rs`**
  and reused by both contracts (no duplication).
- Tests (`cargo test`, 4 pass): MiMC == golden; **the real P2 proof verifies
  in-contract** (on-chain tree root == proof root); double-spend + unknown-root
  rejected. Deployable wasm builds.
- Generators: `zk/scripts/gen-mimc-rust-constants.mjs`,
  `gen-withdraw-soroban-fixture.mjs` (Fp2 order **c1c0**, the working Soroban
  BLS12-381 encoding).

**⚠️ Finding:** 220-round MiMC over `Fr` **exceeds Soroban's default tx budget**
for tree ops (deposit/init) — the Approach-A on-chain tree is correct + tested
but not network-deployable as-is. Withdraw (pairing only) is fine. Fallbacks
(off-chain tree / fewer rounds / shallower tree) in `docs/zk-mimc.md`. Testnet
deploy also pending a Soroban CLI in the agent env. DEMO-GRADE, not audited.
*(→ Superseded by P3.5 (#74): the shallower-tree fallback was taken — depth 4 now
fits the budget and IS network-deployable.)*

**Scoped as a spike (review of PR #73):** the pool is **feature-gated** (`pool`,
default off) so the production Groth16Verifier wasm is unchanged; build/test with
`--features pool`. The deployable pool decision (Approach C off-chain tree, or
fewer MiMC rounds) gates P4/P5 — recorded in `docs/zk-mimc.md`.

## Shielded pool P2: withdraw circuit + trusted setup — #61

Second slice of the shielded-pool epic (#59): the zero-knowledge withdraw
statement that makes payouts unlinkable — prove ownership of a deposit note in
the Merkle tree + a fresh nullifier, without revealing which deposit.

- `zk/circuits/withdraw.circom` — Tornado-style: `commitmentHash(secret,
  nullifier, amount)` leaf, `nullifierHash` check, MiMC Merkle membership to a
  public `root`; public signals `[root, nullifierHash, recipient, amount]`.
  **Depth 4** (16-leaf set) — bounded by on-chain MiMC cost (P3.5, #74), not the
  trusted setup; fits a small 2^15 BLS12-381 ptau.
- `zk/circuits/mimcsponge.circom` + `mimc_constants.circom` (auto-generated from
  P1's `mimc-golden.json`) — MiMCSponge matching `lib/pool/mimc.ts` exactly; the
  in-circuit hashes reproduce every P1 golden vector
  (`zk/scripts/mimc-circuit-crosscheck.mjs`). One documented last-round deviation
  from stock circomlib to match P1 (the source of truth).
- `lib/pool/address.ts` — `recipientToField` encodes a Stellar key as the
  circuit's `recipient` field element (reused by P3/P4).
- Committed artifacts in `zk/artifacts/`: `withdraw.wasm`, `withdraw.r1cs`,
  `withdraw_final.zkey`, `withdraw_vk.json`, and a proof fixture
  (`withdraw_proof.json` / `withdraw_public.json`).
- `zk/withdraw-circuit.test.ts` — fast (zkey-free) verify of the fixture
  (positive + tampered-recipient negative), vk shape, and constant transcription.
- `zk/scripts/build-withdraw.sh` — reproducible compile + demo-grade setup +
  prove/verify. **Trusted setup is demo-grade (single contributor), not a
  ceremony — not for real value.**

No runtime/product surface changes (ZK tooling + artifacts only).

## Shielded pool P1: MiMC golden vectors (circom / Rust / TS) — #60

First slice of the shielded-pool epic (#59). Establishes the MiMC hash as a
single cross-language source of truth **before** the circuit (P2) and Soroban
contract (P3) consume it — cross-language hash agreement is the whole system's
#1 risk.

- `lib/pool/mimc.ts` — reference MiMC over BLS12-381 `Fr`: circomlib MiMCSponge
  (Feistel, S-box `x^5`, 220 rounds, SHA256-seeded constants). Exposes
  `hash2` (Merkle node), `commitmentHash` (deposit leaf), `nullifierHash`.
  Dependency-free (only `node:crypto`); relative `FR` import so `tsx` scripts
  (P4/P5) can use it.
- `zk/artifacts/mimc-golden.json` — the spec: params + all 220 round constants +
  golden input→output vectors; regenerate via `zk/scripts/gen-mimc-golden.mjs`.
- `lib/pool/mimc.test.ts` — locks the reference to the golden file (10 tests:
  vector reproduction, exponent-is-a-permutation, canonical outputs, order
  sensitivity, domain separation).
- `docs/zk-mimc.md` — parameters + how P2/P3 transcribe the constants.

Exponent `5` chosen because `gcd(5, r-1) = 1` over BLS12-381 `Fr` (3 and 11 are
invalid). No runtime/product surface changed.

## Real on-chain leg for the sample payment (`SEED_ONCHAIN`) — #45

The sample payment behind Demo Replay (and every self-serve signup's demo
payment) had a hardcoded **fake** on-chain leg (`demo_tx_…` / `ledger: 1234567`)
duplicated across `prisma/seed.ts` and `lib/auth/signup.ts` — the one honesty
caveat a judge could catch. Now the shielded_transfer contract is live (#31/#36,
#40), so it can be a genuine testnet tx.

- **Guard flag** — `SEED_ONCHAIN` (validated in `lib/env.ts`, default **false**,
  documented in `.env.example`). When `true` **and** a funded
  `STELLAR_SOURCE_SECRET` is present, the sample payment submits a REAL
  `shielded_transfer` tx via `buildAndSubmitPrivatePayment` and records the real
  `txHash`/`ledger`/`contractId`. Otherwise the offline `demo_tx_…` placeholder
  is used, so `docker compose up && pnpm db:seed` and CI seeding still work with
  no network / no key. Logs which path ran (`onchain: real` vs `placeholder`)
  and falls back to the placeholder (never hard-fails) if the submit errors.
- **One shared code path** — new `lib/payments/sample-onchain-leg.ts`
  (`buildSampleOnchainLeg`) is used by **both** the seed and signup, so the leg
  can't drift; the duplicated hardcoded literals are gone. The seed now runs via
  `tsx --conditions=react-server` (like the worker) so it can share the
  server-only-guarded lib modules.
- **Tradeoff (first cut)** — the real leg is written synchronously as
  `CONFIRMED` (the submit polls to inclusion and returns a real ledger), rather
  than `PENDING` + `watch-onchain`. Simpler for the seed; the tx is genuinely
  confirmed on submission.
- **Docs** — `docs/deploy/railway.md` + `docs/demo/runbook.md` note
  `SEED_ONCHAIN=true`.
- **Tests** — `test/lib/payments/sample-onchain-leg.test.ts`: default placeholder
  (no submission), real submit when enabled + funded, fallback on submit error,
  and placeholder when the key isn't a valid secret.

**Verification:** `pnpm run ci` (233 tests) + `pnpm build` + `pnpm zk:demo` green.
With `SEED_ONCHAIN=true`: the seeded sample payment's on-chain leg is a real tx
(`f7dd6a72…`, ledger 3393385) that resolves `successful: true` on Stellar
testnet, and Demo Replay reconciled it (trigger payout → SETTLED) against the
real hash. Default seeding stays fully offline.

---

## Real Groth16 proving by default (`ZK_PROVING=live`) — #46

`shield()` only produced a real Groth16 commitment when `ZK_PROVING=live`, and
that flag was read straight from `process.env` (unvalidated, undocumented) with
the fallback as the effective default. So "Verify proof on-chain" worked on the
seeded sample payment (its `proofHash` is a real commitment) but **failed on a
payment a signed-up user created themselves** — the ZK story was only real for
the seed.

- **Validated + documented** — `ZK_PROVING` is now a `z.enum(["live","fallback"])`
  in `lib/env.ts` (**default `live`**), documented in `.env.example`, and
  consumed via `env.ZK_PROVING`. `isSppAvailable()` reads `env.*`, not raw
  `process.env`.
- **Real for everyone** — with the default, a user-created payment's `proofHash`
  is the real `hexCommitment(deriveCommitment(...))`, so on-chain verify passes
  for the self-serve path, not just the seed.
- **Safe fallback preserved** — the labeled AES-wrap path is unchanged and never
  presents a mocked verification as real. Live proving is local snarkjs (no
  network); if `zk/artifacts/*` are missing at runtime, `shield` catches and
  falls back with the existing clear log instead of crashing.
- **Deploy docs** — `docs/deploy/railway.md` + `staging-checklist.md` note
  `ZK_PROVING=live` on both `web` and `worker`; `docs/zk.md` explains the default
  and its requirements.
- **Tests** — `test/lib/env.test.ts` covers the `live` default, an explicit
  `fallback`, and rejection of an unknown value. `lib/zk/index.test.ts` covers
  proving-live → real-commitment `proofHash` vs fallback → labeled sha256.

**Verification:** `pnpm run ci` + `pnpm build` green; `pnpm zk:demo` unaffected;
a user-created payment's "Verify proof on-chain" returned `{ verified: true }` on
testnet.

---

## Staging branch + Railway deploy dry-run — #41

The MVP checkpoint treats a `staging` branch as the signal that a deploy is
being prepared, and the Railway config (`railway.*.json`, `nixpacks.toml`,
`scripts/release.sh`) had never been exercised. This validates it end-to-end
locally and documents the runbook.

- **`staging` branch** cut from `develop` and pushed to origin.
- **Deploy config validated locally** against docker-compose Postgres+Redis,
  using a throwaway `trexure_staging_dryrun` DB (dev DB untouched):
  `scripts/release.sh` runs `prisma migrate deploy` + the `RUN_SEED_ONCE`-guarded
  seed cleanly on a fresh DB (and skips the seed when unset); `pnpm run ci`
  green; `pnpm build` succeeds; `pnpm worker:prod` boots + heartbeats;
  `GET /api/health` → `200 {"status":"ok","checks":{"db":true,"redis":true,"worker":true}}`.
- **`docs/deploy/staging-checklist.md`** — a checkable runbook enumerating every
  Railway service variable (cross-referenced to `.env.example`), the web/worker
  start/health/release commands, the volume mount, internal-networking
  references (`${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}`), and the
  intended `ENABLE_MOCK_ANCHOR=false` + `ENABLE_NEW_PAYMENTS=true` (#40) values.
  Credential-gated steps (project/DB/Redis/volume/secrets/first deploy) are
  clearly separated from the automatable ones.
- **Gotcha documented:** `pnpm ci` collides with pnpm's reserved (unimplemented)
  `ci` verb — use `pnpm run ci`. GitHub Actions runs the steps individually, so
  CI is unaffected.

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

## New-payment submission enabled by default — #40

The gate from #32 was correct while the `shielded_transfer` contract was
undeployed. Now that #31/#36 are merged and the create→SETTLED loop runs
end-to-end on testnet, the SPEC's primary user action ships **on**.

- **Flag flip** — `ENABLE_NEW_PAYMENTS` now defaults to **true** in `lib/env.ts`
  and `.env.example`. `/payments/new` renders the real form (no `soon` badge)
  and `POST /api/payments` accepts valid submissions. `false` remains a
  deploy-time kill switch if the on-chain leg regresses.
- **Contract drift caveat** — the app resolves the contract from
  `env.ZK_CONTRACT_ID` only (`zk/deploy.json` is used solely by `pnpm zk:demo`).
  Documented in `docs/deploy/railway.md` that both `web` and `worker` must carry
  `ENABLE_NEW_PAYMENTS=true` and the #31 contract id
  (`CBCYXVZCNMQEHLN6NN375KUK2IK54PF3XUB6FMZG2J26K7A4WH2ZVTSG`); a stale id
  reproduces the "non-existent contract function shielded_transfer" failure.
- **Tests** — new `test/lib/env.test.ts` asserts the default is `true` and that
  an explicit `false` is still honored. The existing `test/api/payments.test.ts`
  keeps both the gated-503 and enabled-201 paths covered.

**Verification:** `pnpm ci` green (typecheck/lint/test/audit) + `pnpm build`;
`pnpm zk:demo` still passes; end-to-end from the UI a brand-new payment reaches
**SETTLED** with an on-chain leg whose `txHash` resolves on Stellar testnet.

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

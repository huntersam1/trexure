# Trexure — Full-Stack Application Specification

> A Unified Treasury API for Stellar. Trexure abstracts a privacy-preserving Stellar
> payment into clean, accounting-ready output. It (1) decrypts a company's own
> ZK-shielded on-chain transactions using its view key, (2) reconciles the on-chain
> leg against the off-chain fiat leg (anchor/local payout webhook), and (3) emits a
> clean, "Stripe-ified" receipt that pipes into a dashboard or accounting software.

This document is the build contract for a coding agent. It enumerates every page,
endpoint, database model, background service, third-party integration, environment
variable, and security control required. Read `AGENT.md` alongside this file for
stack conventions and security rules.

---

## 1. Scope & Build Priority

The app is multi-tenant SaaS. A seeded **admin** user exists from day one (basic
username/password auth only — no OAuth, no email magic links).

Build in this order so the live demo is bulletproof even if the ZK layer is partial:

1. **Spine (must work):** Auth → create payment → reconciliation worker matches a
   fiat webhook to an on-chain event → receipt JSON renders in the dashboard.
2. **Differentiator (should work):** ZK shield/decrypt — a payment is stored as an
   encrypted payload + proof hash; applying the tenant's view key server-side
   decrypts it into the true payload.
3. **Polish:** Demo replay mode, audit log, admin console, export.

The reconciliation + receipt flow is the rock-solid core. The ZK layer is presented
as a working differentiator but must never be the thing that breaks the live pitch.

---

## 2. Architecture

Three deployable Railway services sharing one Postgres database and one Redis instance:

| Service | Runtime | Responsibility |
|---|---|---|
| `web` | Next.js 16 (Node) | UI (React Server Components) + API route handlers (auth, payments, receipts, webhook ingestion). |
| `worker` | Node (standalone) | BullMQ consumer: polls Soroban RPC for contract events, matches them to buffered fiat webhooks, writes `SETTLED` state, generates receipts. |
| `postgres` | Railway Postgres 17 | Relational source of truth. |
| `redis` | Railway Redis | BullMQ queue + login rate-limit + idempotency cache. |

File storage (receipt PDF exports, uploaded anchor proofs) uses a Railway **Volume**
mounted to `web` in production and **MinIO** (S3-compatible) in local dev, accessed
through a single storage abstraction so the code path is identical.

### Data flow (happy path)

```
Client → POST /api/payments (initiate private payroll)
  → web builds + submits Soroban tx via @stellar/stellar-sdk (testnet)
  → Payment row created: status=PENDING, encryptedPayload + proofHash stored
  → enqueue "watch-onchain" job (paymentId, expected contract/tx)

Mock Anchor (POST /api/mock-anchor/payout, demo trigger)
  → simulates a PHP payout, then POSTs a SIGNED webhook to /api/webhooks/fiat
    (same HMAC + raw-body contract a real Xendit callback would use)
/api/webhooks/fiat
  → HMAC verified, idempotency-checked
  → FiatLeg row created: status=RECEIVED
  → enqueue "reconcile" job

worker:
  - "watch-onchain": poll Soroban RPC getEvents for the contract; on match,
    write OnchainLeg (txHash, ledger, proofHash); enqueue "reconcile"
  - "reconcile": if both legs present for a Payment and amounts/refs match →
    status=SETTLED, generate Receipt (FX, fees, slippage, both refs)

Client → GET /api/payments/:id/receipt → Stripe-ified JSON
Client → POST /api/payments/:id/decrypt (view key) → decrypted payload (server-side)
```

---

## 3. Tech Stack (pinned to latest stable as of June 2026)

> Use these major lines. Resolve to the newest patch at install time; do not pin
> below these. Verify with `pnpm outdated` before submission.

| Layer | Choice | Version line |
|---|---|---|
| Runtime | Node.js | 22 LTS (Next 16 + Prisma 7 require Node 20+) |
| Package manager | pnpm | 10.x |
| Framework | Next.js (App Router) | 16.2.x (LTS line; Turbopack default) |
| UI | React / React DOM | 19.x |
| Language | TypeScript | 5.x (strict) |
| Styling | Tailwind CSS | 4.x (CSS-first config, `@tailwindcss/postcss`) |
| ORM | Prisma | 7.x (Rust-free client; `prisma-client` generator) |
| DB driver adapter | `@prisma/adapter-pg` + `pg` | latest (Prisma 7 requires a driver adapter) |
| DB | PostgreSQL | 17 (Railway) |
| Queue/cache | BullMQ + `ioredis` | 5.x / 5.x |
| Validation | Zod | 4.x |
| Password hashing | `argon2` (argon2id) | latest |
| Stellar client | `@stellar/stellar-sdk` | 15.1.x (Protocol 26 XDR) |
| Logging | `pino` + `pino-http` | latest |
| Dev DB/storage | Docker Compose: postgres:17, minio, redis:7 | — |
| S3 client | `@aws-sdk/client-s3` (MinIO + Railway volume gateway) | latest |

**ZK layer:** fork **Nethermind Stellar Private Payments (SPP)** for the privacy-pool
contracts, Circom circuits, and client-side WASM proving. Do not author new ZK
circuits. Trexure treats SPP as a dependency: it submits private payments and stores
the resulting encrypted payload + proof hash, then decrypts with the tenant view key.
If SPP integration slips, fall back to a Groth16 verifier contract that *gates* the
payout so on-chain proof verification stays real (never mock the verification itself).

---

## 4. Pages (Next.js App Router)

All routes except `/login` require an authenticated session. All data-bearing routes
are tenant-scoped. Role `ADMIN` unlocks `/admin/*`.

| Route | Type | Access | Purpose / key components |
|---|---|---|---|
| `/login` | Client form + server action | Public | Username + password. On success sets httpOnly session cookie, redirects to `/`. |
| `/` (dashboard) | RSC | Auth | KPI strip (volume settled, pending count, avg settlement time) + recent payments table + **Demo Replay** button that runs Shield→Decrypt→Reconcile→Receipt on a sample payment. |
| `/payments` | RSC | Auth | Paginated, filterable list of payments. Columns: status badge, amount, corridor (e.g. USD→PHP), created, settled. |
| `/payments/new` | Client + server action | Auth | Initiate a (private) payroll/payout: recipient, amount, source asset, target currency/anchor. Submits Soroban tx. |
| `/payments/[id]` | RSC + client islands | Auth (tenant-scoped) | The lifecycle view. Four-state component: **PublicLedgerView** (shielded blob + proof hash) → **EnclavePanel** ("Apply View Key" → decrypted payload) → **ReconciliationRow** (on-chain ↔ fiat merge, Pending→Settled) → **ReceiptPanel** (Stripe-style card + collapsible raw JSON + Copy/Export). |
| `/receipts/[id]` | RSC | Auth (tenant-scoped); optional signed public link | Standalone shareable receipt. "Copy JSON" / "Export PDF". |
| `/settings` | RSC + client | Auth | Manage tenant view key (write-only input, never displayed), anchor config, webhook secret rotation, API keys. |
| `/settings/api-keys` | Client | Auth | Create/revoke tenant API keys for programmatic receipt/payment access. |
| `/admin` | RSC | ADMIN | Tenant + user management, global webhook event log, worker/job health. |
| `/admin/webhooks` | RSC | ADMIN | Raw inbound webhook events with verification status and idempotency outcome. |

UI direction: serious fintech (Stripe Dashboard / Mercury bank), not crypto.
Restrained neutral palette + one accent, monospace only for hashes/JSON, subtle
state-transition animations. See `frontend-design` skill for tokens. Reusable
components: `TransactionCard` (shielded/decrypted toggle), `StatusBadge`
(Shielded/Pending/Settled/Failed), `ReconciliationRow`, `ReceiptPanel`, `KpiStat`.

All blockchain detail lives in an optional "Advanced" drawer — the default view hides
the ledger, reinforcing the "abstract the ledger" thesis.

---

## 5. API Endpoints (Route Handlers, `app/api/**/route.ts`)

Conventions: JSON in/out; Zod-validate every input; tenant-scope every query; return
RFC-9457 problem+json on error; never leak stack traces. Mutating routes require a
valid session **and** CSRF/origin check. Webhook routes are unauthenticated by session
but authenticated by HMAC signature.

### Auth
| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/api/auth/login` | public | `{ username, password }` → sets `__Host-session` cookie. Rate-limited (Redis, per-IP + per-username). Generic error on failure (no user enumeration). |
| POST | `/api/auth/logout` | session | Invalidates server session row, clears cookie. |
| GET | `/api/auth/session` | session | Returns `{ user: { id, username, role, tenantId } }` or 401. |

### Payments
| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/api/payments` | session | Query: `status`, `corridor`, `cursor`, `limit`. Tenant-scoped, cursor-paginated. |
| POST | `/api/payments` | session + CSRF | `{ recipientRef, amount, sourceAsset, targetCurrency, anchorId, memo? }`. Builds + submits Soroban tx; creates `Payment(status=PENDING)` with `encryptedPayload`, `proofHash`. Enqueues `watch-onchain`. Idempotent via `Idempotency-Key` header. |
| GET | `/api/payments/[id]` | session (tenant) | Full payment with legs + receipt (if any). |
| POST | `/api/payments/[id]/decrypt` | session (tenant) | Loads tenant view key (decrypted server-side from KMS/AES), unwraps `encryptedPayload`, returns decrypted payload. **Never** returns the view key. Audit-logged. |
| GET | `/api/payments/[id]/receipt` | session (tenant) or API key | Stripe-ified receipt JSON (see §6.4). |
| POST | `/api/payments/[id]/retry-reconcile` | session (tenant) | Re-enqueues `reconcile`. |

### Webhooks (HMAC-authenticated, no session)
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/webhooks/fiat` | HMAC | Anchor payout callback (real Xendit **or** the Mock Anchor — identical contract). **Read raw body** for signature verify (`x-callback-token`/HMAC). Idempotent on provider event id. Creates `FiatLeg`, enqueues `reconcile`. Always 2xx fast; do work in worker. |
| POST | `/api/webhooks/chain` | HMAC/shared-secret | Optional push ingestion of Soroban events from an indexer (Mercury/SubQuery) if not polling. Same idempotency + enqueue pattern. |

### Mock Anchor (thin internal API — stands in for Xendit; see §8.1)
> Flag-gated by `ENABLE_MOCK_ANCHOR`; requires session in dev/demo. It mocks the
> **provider**, not the verification path — it fires a real signed webhook at
> `/api/webhooks/fiat`, so HMAC verify + idempotency + reconciliation run exactly as
> they would in production.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/mock-anchor/payout` | session | `{ intentId, amount, currency, recipientRef, delayMs?, fail? }`. Simulates a PHP bank payout, waits `delayMs` (default ~1500ms), then POSTs an HMAC-signed `payment.completed` event to `/api/webhooks/fiat` with a generated `providerRef`/`bankRef`. `fail:true` emits a `payment.failed` event to demo the FAILED path. Returns `{ providerRef, bankRef, status }`. |
| GET | `/api/mock-anchor/payouts` | session | Lists simulated payouts (for the admin/demo view). |

### Admin & API-key
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/tenants` | ADMIN | List tenants + user counts. |
| POST | `/api/admin/users` | ADMIN | Create user `{ username, password, role, tenantId }`. |
| GET | `/api/admin/webhook-events` | ADMIN | Raw webhook log w/ verification + idempotency status. |
| GET | `/api/health` | public | Liveness: DB ping, Redis ping, worker heartbeat. |
| POST | `/api/keys` | session + CSRF | Create tenant API key (returns once, store only hash). |
| DELETE | `/api/keys/[id]` | session + CSRF | Revoke. |

Programmatic access via API key uses `Authorization: Bearer <key>`; the server hashes
and looks up the key, resolving its tenant for scoping.

---

## 6. Background Worker & Reconciliation

Standalone Node process (`worker/index.ts`) running BullMQ workers on Redis.

### 6.1 Queues / jobs
- `watch-onchain` — poll Soroban RPC `getEvents` for the payment's contract/topic
  within a ledger window; on match write `OnchainLeg` and enqueue `reconcile`.
  Backoff with cap; mark `Payment.status=FAILED` after max attempts + timeout.
- `reconcile` — load both legs for the payment; match on amount (within tolerance for
  FX/slippage), corridor, and a shared reference (memo/intent id acting as the join
  key). On match: `status=SETTLED`, compute FX rate/fees/slippage, create `Receipt`.
- `generate-receipt` — (can be folded into reconcile) produce + persist receipt JSON
  and optional PDF export to storage.

### 6.2 Matching key
Use a stable correlation id (the "intent id") embedded in both the Soroban tx memo and
the fiat payout reference. This is the reconciliation join key — the conceptual core of
the product. Never match on amount alone.

### 6.3 Idempotency & ordering
Either leg may arrive first. Worker is order-independent and idempotent: reconciling
twice is a no-op once `SETTLED`. Use a DB unique constraint on `(paymentId, legType)`.

### 6.4 Receipt object (Stripe-ified)
```jsonc
{
  "id": "rcpt_…",
  "paymentId": "pay_…",
  "status": "settled",
  "created": "2026-07-15T08:21:04Z",
  "corridor": { "from": "USD", "to": "PHP" },
  "amounts": {
    "source": { "currency": "USD", "value": "2500.00" },
    "destination": { "currency": "PHP", "value": "141750.00" }
  },
  "fx": { "rate": "56.70", "asOf": "2026-07-15T08:20:55Z" },
  "fees": { "network": "0.00041 XLM", "anchor": "PHP 50.00", "platform": "0.00" },
  "slippage": "0.0008",
  "onchain": { "txHash": "…", "ledger": 123456, "proofHash": "…", "asset": "USDC" },
  "fiat": { "provider": "mock-anchor", "reference": "…", "bankRef": "…" },
  "privacy": { "shielded": true, "viewKeyDisclosed": false }
}
```

---

## 7. Database Schema (Prisma 7)

PostgreSQL. Use `cuid()`/`uuid()` ids, `createdAt`/`updatedAt` on every model, soft
delete only where needed. Enforce tenant isolation in application code via a Prisma
extension that injects `tenantId` into every query (see AGENT.md). Optionally also
enable Postgres RLS for defense-in-depth.

```prisma
// generator + datasource: see AGENT.md for Prisma 7 setup (driver adapter, prisma.config.ts)

enum Role { ADMIN MEMBER }
enum PaymentStatus { DRAFT PENDING ONCHAIN_CONFIRMED RECONCILING SETTLED FAILED }
enum LegType { ONCHAIN FIAT }
enum LegStatus { PENDING RECEIVED CONFIRMED FAILED }

model Tenant {
  id        String   @id @default(cuid())
  name      String
  users     User[]
  payments  Payment[]
  viewKey   ViewKey?
  apiKeys   ApiKey[]
  anchors   AnchorConfig[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id           String   @id @default(cuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  username     String   @unique
  passwordHash String                 // argon2id; NEVER plaintext
  role         Role     @default(MEMBER)
  sessions     Session[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([tenantId])
}

model Session {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique           // store hash of session token, not the token
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  ip         String?
  userAgent  String?
  @@index([userId])
}

model ViewKey {
  id           String   @id @default(cuid())
  tenantId     String   @unique
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  encryptedKey Bytes                    // AES-256-GCM, app/KMS-encrypted at rest
  nonce        Bytes
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Payment {
  id               String        @id @default(cuid())
  tenantId         String
  tenant           Tenant        @relation(fields: [tenantId], references: [id])
  intentId         String        @unique   // reconciliation join key (in memo + fiat ref)
  status           PaymentStatus @default(DRAFT)
  sourceAsset      String
  sourceAmount     Decimal       @db.Decimal(38, 8)
  targetCurrency   String
  targetAmount     Decimal?      @db.Decimal(38, 8)
  corridorFrom     String
  corridorTo       String
  recipientRef     String                    // opaque; PII minimized
  shielded         Boolean       @default(true)
  encryptedPayload Bytes?                     // ZK-shielded payload blob
  payloadNonce     Bytes?
  proofHash        String?
  legs             PaymentLeg[]
  receipt          Receipt?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  @@index([tenantId, status])
  @@index([tenantId, createdAt])
}

model PaymentLeg {
  id          String    @id @default(cuid())
  paymentId   String
  payment     Payment   @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  legType     LegType
  status      LegStatus @default(PENDING)
  // onchain
  txHash      String?
  ledger      Int?
  contractId  String?
  // fiat
  provider    String?
  providerRef String?
  bankRef     String?
  amount      Decimal?  @db.Decimal(38, 8)
  currency    String?
  receivedAt  DateTime?
  createdAt   DateTime  @default(now())
  @@unique([paymentId, legType])           // idempotency: one leg of each type
  @@index([txHash])
  @@index([providerRef])
}

model Receipt {
  id          String   @id @default(cuid())
  paymentId   String   @unique
  payment     Payment  @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  json        Json                          // the Stripe-ified object (§6.4)
  pdfKey      String?                       // storage key if exported
  generatedAt DateTime @default(now())
}

model AnchorConfig {
  id           String   @id @default(cuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  provider     String                       // "xendit"
  webhookSecret Bytes                        // encrypted at rest
  config       Json
  createdAt    DateTime @default(now())
  @@index([tenantId])
}

model ApiKey {
  id         String    @id @default(cuid())
  tenantId   String
  tenant     Tenant    @relation(fields: [tenantId], references: [id])
  name       String
  keyHash    String    @unique              // store hash only
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  @@index([tenantId])
}

model WebhookEvent {
  id           String   @id @default(cuid())
  provider     String
  externalId   String                       // provider event id for idempotency
  verified     Boolean
  payload      Json
  processedAt  DateTime?
  createdAt    DateTime @default(now())
  @@unique([provider, externalId])
}

model AuditLog {
  id        String   @id @default(cuid())
  tenantId  String?
  userId    String?
  action    String                          // e.g. "viewkey.decrypt", "auth.login"
  target    String?
  metadata  Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([tenantId, createdAt])
}
```

---

## 8. Third-Party Services & Integrations

| Service | Use | Notes |
|---|---|---|
| **Stellar testnet** (Soroban RPC + Horizon) | Submit/observe contract txs | Via `@stellar/stellar-sdk` 15.x. Default testnet RPC URL; fund accounts via Friendbot. |
| **Nethermind Stellar Private Payments (forked)** | ZK shield/decrypt | Privacy-pool contracts + Circom circuits + WASM client proving. Trexure stores encrypted payload + proof hash and decrypts with view key. |
| **Mock Anchor** (built-in, this app) | Fiat anchor / PHP payout webhook — **stands in for Xendit** | No external account needed. Thin internal API that simulates a payout and fires a real signed webhook. Real Xendit is a drop-in later (same webhook contract). See §8.1. |
| **Railway** | Postgres 17, Redis, Volume storage, deploy `web` + `worker` | One project, multiple services; shared internal networking. |
| **MinIO** (dev only) | S3-compatible local file storage | Mirrors Railway volume gateway via `@aws-sdk/client-s3`. |
| **Mercury / SubQuery** (optional) | Soroban event indexing | Only if you choose push-ingestion over RPC polling. For hackathon, RPC polling is enough. |
| **Xendit (optional, post-hackathon)** | Real PHP payout provider | Drop-in replacement for the Mock Anchor: same `/api/webhooks/fiat` contract and HMAC. Add real `x-callback-token` and point the Xendit dashboard at the webhook URL — no app code changes. |

No third-party service keys are ever shipped to the client. All Stellar signing, ZK
decryption, and webhook verification happen server-side (`web`/`worker`).

### 8.1 Mock Anchor (thin Xendit stand-in)

Because no Xendit account is available, Trexure ships a **Mock Anchor**: a thin internal
module (`lib/anchor/mock.ts`) plus the `/api/mock-anchor/*` routes (§5). The design rule
is **mock the provider, not the verification** — everything downstream of the webhook is
real, so the demo proves the production reconciliation path, not a shortcut.

- **What it fakes:** the existence of an external payout provider and the bank payout
  itself (it invents a `providerRef` and `bankRef` and an FX/fee figure).
- **What stays real:** it constructs a Xendit-shaped JSON event, signs it with the same
  HMAC/`x-callback-token` secret the app uses to verify, and POSTs it to the real
  `/api/webhooks/fiat` endpoint. The webhook handler verifies the signature, enforces
  idempotency via `WebhookEvent(provider, externalId)`, and enqueues `reconcile` exactly
  as it would for a genuine Xendit callback.
- **Event shape** (provider field = `"mock-anchor"`):
  ```jsonc
  {
    "id": "evt_mock_…",                 // externalId → idempotency
    "event": "payment.completed",       // or "payment.failed"
    "intentId": "intent_…",             // reconciliation join key (also in tx memo)
    "providerRef": "mock_payout_…",
    "bankRef": "PH-BANK-…",
    "amount": "141750.00",
    "currency": "PHP",
    "fxRate": "56.70",
    "anchorFee": "50.00",
    "createdAt": "2026-07-15T08:21:03Z"
  }
  ```
- **Demo controls:** `delayMs` simulates settlement latency (so judges *see* Pending →
  Settled), and `fail:true` emits `payment.failed` to demo the FAILED/retry path.
- **Safety:** gated by `ENABLE_MOCK_ANCHOR`; disabled in production builds. It uses the
  same `ANCHOR_CALLBACK_TOKEN` secret as the webhook verifier — set a real Xendit token
  here later and the mock simply stops being used.
- **Swap path:** to go live, set `ANCHOR_PROVIDER=xendit`, supply real Xendit keys, and
  register the webhook URL in Xendit. No change to `/api/webhooks/fiat`, the worker, or
  the receipt.

---

## 9. Authentication & Authorization

- **Mechanism:** basic username + password only. Seeded `admin` (see §12).
- **Password storage:** `argon2id` (argon2 lib) with sane memory/time cost. Never store
  or log plaintext.
- **Sessions:** opaque random 256-bit token in a `__Host-`prefixed cookie
  (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`). Store only the **hash** of the
  token in `Session.tokenHash`. Sliding expiry; absolute max lifetime. Logout deletes
  the row.
- **CSRF:** since auth is cookie-based, protect all state-changing requests with an
  origin/`Sec-Fetch-Site` check plus a double-submit CSRF token for form posts.
- **AuthZ:** middleware guards `/` and `/api/**` (except `/login`, `/api/auth/login`,
  webhooks, `/api/health`). Role check for `/admin/**`. Every query is tenant-scoped;
  a user can never read another tenant's rows.
- **API keys:** Bearer keys for programmatic access, stored as hashes, tenant-scoped,
  revocable.
- **Login throttling:** Redis-backed rate limit per IP and per username; exponential
  lockout. Uniform error messages (no user enumeration, constant-time compare).

---

## 10. Security Requirements (must implement)

1. **Validate all input** with Zod at the boundary; reject unknown fields.
2. **Secrets only in env / Railway variables**; never commit; never expose to client
   bundles (no secret in `NEXT_PUBLIC_*`).
3. **Encrypt sensitive data at rest:** view keys, anchor webhook secrets — AES-256-GCM
   with a `MASTER_ENCRYPTION_KEY` from env (KMS in prod). Store nonce per record.
4. **Webhook security:** verify HMAC over the **raw** body; enforce idempotency via
   `WebhookEvent (provider, externalId)` unique; respond 2xx quickly, process async.
5. **Tenant isolation:** Prisma client extension injects/enforces `tenantId`; consider
   Postgres RLS as defense-in-depth. Add tests that one tenant cannot read another's data.
6. **Security headers** via middleware: strict `Content-Security-Policy` (no inline
   scripts; nonce-based), `Strict-Transport-Security`, `X-Content-Type-Options=nosniff`,
   `Referrer-Policy=strict-origin-when-cross-origin`, `X-Frame-Options=DENY`.
7. **Rate limit** auth + webhook + API-key routes (Redis).
8. **Audit log** sensitive actions: login, view-key decrypt, key creation, admin ops.
9. **No PII on-chain** and minimize PII in DB (store opaque `recipientRef`).
10. **Error hygiene:** problem+json, no stack traces or secret values in responses/logs;
    redact tokens in logs (`pino` redaction).
11. **Dependency hygiene:** keep `next` patched (active security advisories on RSC /
    middleware); run `pnpm audit` in CI; pin to latest stable lines from §3.
12. **Least privilege:** the `worker` connects with its own DB role; API keys carry
    only tenant scope; admin actions require role `ADMIN`.
13. **HTTPS only** in production; cookies `Secure`; reject mixed content.

---

## 11. Environment Variables

```env
# Core
NODE_ENV=development
APP_URL=http://localhost:3000

# Database (Railway Postgres / local docker)
DATABASE_URL=postgresql://trexure:trexure@localhost:5432/trexure?schema=public
SHADOW_DATABASE_URL=postgresql://trexure:trexure@localhost:5432/trexure_shadow

# Redis (Railway / local docker)
REDIS_URL=redis://localhost:6379

# Auth & crypto
SESSION_COOKIE_NAME=__Host-trexure_session
MASTER_ENCRYPTION_KEY=        # 32-byte base64; AES-256-GCM key for at-rest encryption
CSRF_SECRET=                  # random 32+ bytes

# Seed admin (used only by seed script)
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=          # strong; required, no default in prod
SEED_ADMIN_TENANT=Trexure HQ

# Stellar
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOURCE_SECRET=        # server signing key (testnet); never client-exposed
ZK_CONTRACT_ID=               # forked SPP / verifier contract id

# Fiat anchor (Mock Anchor is the default; Xendit is an optional drop-in later)
ANCHOR_PROVIDER=mock-anchor    # "mock-anchor" | "xendit"
ANCHOR_CALLBACK_TOKEN=         # shared secret used to BOTH sign (mock) and verify the fiat webhook
ENABLE_MOCK_ANCHOR=true        # gates /api/mock-anchor/*; set false in production
# XENDIT_API_KEY=              # only when ANCHOR_PROVIDER=xendit (post-hackathon)
# XENDIT_CALLBACK_TOKEN=       # if set, use this instead of ANCHOR_CALLBACK_TOKEN to verify

# Storage (S3-compatible: MinIO in dev, Railway volume gateway in prod)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=trexure-receipts
S3_FORCE_PATH_STYLE=true
```

Provide `.env.example` (committed, no secrets) and `.env` (gitignored). In Railway, set
the same keys as service variables; reference Postgres/Redis via Railway-provided
connection strings.

---

## 12. Seed Script (admin account)

`prisma/seed.ts` (wired through `prisma.config.ts` per Prisma 7):

- Create the seed tenant (`SEED_ADMIN_TENANT`).
- Create the `admin` user: `role=ADMIN`, `passwordHash = argon2id(SEED_ADMIN_PASSWORD)`.
- Refuse to run in production if `SEED_ADMIN_PASSWORD` is empty/weak.
- Generate a tenant `ViewKey` (encrypted) and a sample `AnchorConfig` (provider `mock-anchor`) for the demo.
- Insert one sample **shielded** `Payment` (USD→PHP, $2,500) with an on-chain leg and
  `encryptedPayload`/`proofHash` but **no fiat leg yet**, so Demo Replay (§14.2) can run
  beats 1–2 immediately and trigger the Mock Anchor payout for beats 3–4 on first boot.
- Idempotent: upsert by unique username/tenant name + sample `intentId` so re-running and
  Demo Replay resets are safe.

Run: `pnpm db:seed`.

---

## 13. Local Development Configuration

`docker-compose.yml` brings up dev dependencies (app runs on host via pnpm):

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: trexure
      POSTGRES_PASSWORD: trexure
      POSTGRES_DB: trexure
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
volumes:
  pgdata:
  miniodata:
```

Dev bootstrap:
```bash
docker compose up -d
pnpm install
pnpm db:migrate        # prisma migrate dev
pnpm db:seed
pnpm dev               # web (Next.js)
pnpm worker:dev        # worker (separate terminal)
```

---

## 14. Demo Flow (detailed)

The demo is a single payment's lifecycle — a **$2,500 USD → PHP private payroll payout
to a Filipino contractor** — walked through four states. It is designed to (a) be
judge-legible in under 3 minutes, (b) exercise the real production path end-to-end, and
(c) degrade gracefully if the ZK layer is only partially integrated. The Mock Anchor
(§8.1) replaces Xendit; everything downstream of the webhook is real.

### 14.1 The four beats

**Beat 1 — Public Ledger View (the Shield).**
The dashboard opens on `/payments/[id]` showing a block-explorer-style card for the
on-chain leg. Because the payment was routed through the ZK privacy pool, the public
view shows **no sender, no receiver, no amount** — only a verified **proof hash** and a
`Shielded` badge. Narration: *"This is all a competitor scraping the public Stellar
ledger can see. They cannot read this company's payroll."*
- Backed by: `Payment.encryptedPayload` + `proofHash`; `PublicLedgerView` component.
- Data state: `Payment.status = PENDING`, on-chain leg present, fiat leg absent.

**Beat 2 — Internal Enclave (the Decryption).**
Click **Apply View Key**. The request hits `POST /api/payments/[id]/decrypt`, which loads
the tenant's AES-encrypted `ViewKey`, decrypts it **server-side**, unwraps
`encryptedPayload`, and returns the true payload. The shielded blob animates open to
reveal sender, recipient, asset (USDC), and the $2,500 amount. Narration: *"The company
holds its own view key, so it — and only it, plus a regulator it chooses — can read this
for AML/KYC. The key never leaves the server and is never shown."*
- Backed by: `EnclavePanel`; `ViewKey` (AES-256-GCM); audit-logged decrypt.
- The view key is never returned to the client or logged (verify in `AuditLog`).

**Beat 3 — Auto-Reconciliation (the Webhook).**
Click **Trigger Payout** (or let Demo Replay do it). This calls
`POST /api/mock-anchor/payout` with the payment's `intentId`. After a short `delayMs`,
the Mock Anchor fires an HMAC-signed `payment.completed` event at the **real**
`/api/webhooks/fiat`. The webhook verifies the signature, writes the `FiatLeg`, and
enqueues `reconcile`. The worker matches both legs on the `intentId`, flips
`status → SETTLED`, and the UI's `ReconciliationRow` visibly stitches the on-chain hash
and the bank reference together (Pending → Settled). Narration: *"The moment the peso
payout lands, we automatically prove on-chain hash X produced bank deposit Y."*
- Backed by: `/api/mock-anchor/payout` → `/api/webhooks/fiat` → `reconcile` worker.
- Watch the status badge transition live; the `delayMs` exists so judges *see* it happen.

**Beat 4 — The Output (the "Stripe" Receipt).**
The `ReceiptPanel` renders the unified, human-readable receipt (§6.4): exact FX rate,
network + anchor fees, slippage, both transaction references, and a `privacy` block.
A collapsible drawer shows the raw JSON; **Copy JSON** / **Export PDF** are available.
Narration: *"This is what their accounting team and QuickBooks actually want — the
blockchain is completely abstracted away."*
- Backed by: `Receipt.json`; `GET /api/payments/[id]/receipt`.

### 14.2 Demo Replay mode

The dashboard **Demo Replay** button runs all four beats automatically on a seeded
sample payment, with paced transitions, so the pitch works even without live typing and
recovers instantly if a manual step misfires. Implementation:
- Seed creates a sample `Payment` (shielded, on-chain leg present, no fiat leg) so beats
  1–2 are ready on first boot.
- Replay calls `decrypt`, then `mock-anchor/payout` (with a visible `delayMs`), then
  polls the payment until `SETTLED` and reveals the receipt.
- Replay is idempotent: it resets the sample payment's fiat leg + receipt before running
  so it can be demoed repeatedly.

### 14.3 Demo-day runbook (≈3 minutes)

1. Log in as `admin` (or start already authenticated). *(10s)*
2. Open the sample payment → **Beat 1**: show the shielded public view. *(25s)*
3. **Apply View Key** → **Beat 2**: blob decrypts to the real payroll. *(30s)*
4. **Trigger Payout** → **Beat 3**: watch Pending → Settled as the webhook reconciles. *(45s)*
5. **Beat 4**: open the receipt, expand raw JSON, hit Copy/Export. *(40s)*
6. One line on the moat: *"Stellar-native, ZK-private, locally reconciled — no incumbent
   does all three."* *(20s)*

### 14.4 Failure-path demo (optional, strong for judges)

Trigger `POST /api/mock-anchor/payout` with `fail:true` to emit `payment.failed`. Show
the payment moving to `FAILED`, then **Retry Reconcile**
(`POST /api/payments/[id]/retry-reconcile`) followed by a successful payout to recover.
This demonstrates the system handles real-world edge cases (failed payouts), which
separates "real product" from "happy-path prototype."

### 14.5 Graceful degradation (if ZK integration is partial)

If forked-SPP integration isn't fully live by demo day, keep beats 1–2 **visually** real
using a stored `encryptedPayload` + a real on-chain proof-verification call (or the
labeled Groth16-verifier fallback from §3), and narrate the privacy layer as "shipped on
testnet." Beats 3–4 (reconciliation + receipt) must always be fully live — they are the
bulletproof core and carry the demo regardless. Never present a mocked proof
*verification* as real.

### 14.6 Beat → feature map

| Demo beat | Backed by |
|---|---|
| 1. Public ledger "shield" | `Payment.encryptedPayload` + `proofHash`; `PublicLedgerView` |
| 2. Apply view key → true payload | `POST /api/payments/:id/decrypt`; `EnclavePanel`; `ViewKey` (server-side AES) |
| 3. Trigger payout → auto-reconcile | `POST /api/mock-anchor/payout` → `/api/webhooks/fiat` → `reconcile` worker → `SETTLED` |
| 4. Unified Stripe-style receipt | `Receipt.json` (§6.4); `ReceiptPanel`; `GET /api/payments/:id/receipt` |
| Replay / Failure path | Demo Replay action; `fail:true` + `retry-reconcile` |

---

## 15. Acceptance Checklist

- [ ] `admin` can log in with seeded credentials; bad creds are throttled + generic.
- [ ] A new payment submits a real Soroban testnet tx and stores proof hash + encrypted payload.
- [ ] Applying the view key decrypts the payload server-side; the key is never returned or logged.
- [ ] A fiat webhook with a valid HMAC creates a fiat leg; an invalid one is rejected; duplicates are idempotent.
- [ ] `POST /api/mock-anchor/payout` fires a signed webhook that the real `/api/webhooks/fiat` verifies and reconciles; `fail:true` drives the FAILED path; mock routes are disabled when `ENABLE_MOCK_ANCHOR=false`.
- [ ] The worker matches both legs on the intent id and writes `SETTLED` + a receipt.
- [ ] `GET /api/payments/:id/receipt` returns the §6.4 shape.
- [ ] Tenant A cannot read Tenant B's payments/receipts (tested).
- [ ] Security headers present; no secrets in client bundle; `pnpm audit` clean of highs.
- [ ] `docker compose up` + migrate + seed + `pnpm dev` works from a clean checkout.
- [ ] Both `web` and `worker` deploy on Railway and pass `/api/health`.

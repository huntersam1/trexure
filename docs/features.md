# Features — shipped log

A running, append-only log of shipped features. One entry per merged change
(newest first). Each entry links the issue/PR and summarizes what landed.

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

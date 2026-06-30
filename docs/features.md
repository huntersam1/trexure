# Features — shipped log

A running, append-only log of shipped features. One entry per merged change
(newest first). Each entry links the issue/PR and summarizes what landed.

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

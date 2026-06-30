# Database migration conventions

Read this before making any schema change.

## Tooling

- **Prisma 7** with the `prisma-client` generator (output `lib/generated/prisma`)
  and the `@prisma/adapter-pg` driver adapter. Connection URLs live in
  `prisma.config.ts` (`datasource.url` / `datasource.shadowDatabaseUrl`), not in
  the schema `datasource` block.
- A `SHADOW_DATABASE_URL` (e.g. `trexure_shadow`) must exist for `migrate dev`.

## Workflow

- **Dev:** edit `prisma/schema.prisma`, then
  `pnpm db:migrate` (`prisma migrate dev --name <change>`).
- **Naming:** use a short, descriptive snake_case name
  (`add_payment_proof_hash`, not `update`). Prisma prefixes a UTC timestamp:
  `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`.
- **One logical change per migration.** Never hand-edit an already-applied
  migration; create a new one. Migrations are append-only and committed.
- **Release/prod:** the release step runs `pnpm db:deploy`
  (`prisma migrate deploy`) — **never** `migrate dev` — followed by a guarded
  one-time `pnpm db:seed`.

## Schema rules (see AGENT §4)

- Money is `Decimal @db.Decimal(38, 8)` — never `Float`/JS `number`.
- Enum values: one per line (the Prisma 7.8 parser rejects single-line enums).
- Tenant-scoped models must be reachable through the `forTenant()` extension in
  `lib/db.ts`; add new tenant-scoped models to `DIRECT_TENANT_MODELS` (own
  `tenantId` column) or `RELATION_TENANT_MODELS` (scoped via a parent relation).
- Encrypted-at-rest material is stored as `Bytes` (ciphertext + per-record
  nonce); never store plaintext secrets, view keys, passwords, or tokens.

## Seed

`prisma/seed.ts` is idempotent (deterministic ids + upserts) so it can be
re-run safely, including by Demo Replay resets. Keep it idempotent.

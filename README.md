# Trexure

**A unified treasury API for Stellar.** Trexure takes a privacy-shielded Stellar
payment and turns it into clean, accounting-ready output: it (1) decrypts a
company's own ZK-shielded on-chain transaction using its view key, (2)
reconciles the on-chain leg against the off-chain fiat leg (anchor/payout
webhook), and (3) emits a "Stripe-ified" receipt that drops straight into a
dashboard or accounting software.

To the public Stellar ledger a shielded payment is opaque — no sender, no
recipient, no amount. Internally, the tenant that owns it can decrypt it,
watch it auto-reconcile against the real payout, and export a branded PDF
receipt.

## What's real here

- **Shield/decrypt** — payloads are encrypted at rest (AES-256-GCM); a
  tenant's own view key decrypts server-side, key material never reaches the
  browser or the logs.
- **Zero-knowledge proof** — a genuine Groth16 circuit (Circom, BLS12-381),
  proved with `snarkjs`, verified **on-chain** by a hand-written Soroban smart
  contract doing real BLS12-381 pairing checks — not mocked. See
  [`docs/zk.md`](docs/zk.md).
- **Reconciliation** — a BullMQ worker matches an on-chain leg against an
  independently-arriving, HMAC-signed fiat webhook by `intentId`, with
  idempotency and a failure/retry path.
- **Receipts** — a §6.4-spec receipt (FX rate, fees, slippage, both
  references, privacy block) renders in the dashboard and exports as a
  server-rendered PDF via signed URL.
- **Multi-tenant SaaS spine** — argon2id auth, CSRF double-submit, tenant
  row-isolation, RFC-9457 problem+json errors, audit logging.

The **Anchor** (Xendit) is mocked for the demo — Mock Anchor fires the same
signed webhook a real anchor would; everything downstream of it is live.

## Stack

Next.js 16 (App Router, RSC) · React 19 · TypeScript (strict) · Tailwind CSS 4
· Prisma 7 + `@prisma/adapter-pg` · PostgreSQL 17 · BullMQ + ioredis (Redis) ·
Zod 4 · `@stellar/stellar-sdk` (Soroban testnet) · Circom + snarkjs (Groth16) ·
Rust/Soroban SDK (on-chain verifier) · pdfkit · pino.

Three deployable services (`web`, standalone `worker`, shared Postgres +
Redis) — see [`SPEC.md §2`](SPEC.md) for the full architecture and data flow.

## Quickstart (local)

Requires Node ≥22, pnpm ≥10, Docker.

```bash
cp .env.example .env               # fill in MASTER_ENCRYPTION_KEY, CSRF_SECRET, SEED_ADMIN_PASSWORD, etc.
docker compose up -d               # Postgres 17 + Redis + MinIO
pnpm install --frozen-lockfile
pnpm db:deploy && pnpm db:seed      # migrate + seed admin user + sample shielded payment
pnpm dev                           # web -> http://localhost:3000
pnpm worker:dev                   # reconciliation worker (separate terminal)
```

Log in at `/login` with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` from
your `.env`. The dashboard's **Demo Replay** button runs the full
Shield → Decrypt → Reconcile → Receipt flow against the seeded sample
payment.

## Testing & CI

```bash
pnpm test        # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm ci           # typecheck + lint + test + audit (what CI runs)
```

## Demo tooling

```bash
pnpm zk:demo          # live Groth16 proof generated + verified on Stellar testnet
pnpm demo:record      # scripted Playwright recording of the full payment lifecycle -> mp4
```

See [`scripts/record-demo.mjs`](scripts/record-demo.mjs) and
[`docs/demo/runbook.md`](docs/demo/runbook.md) for the manual demo script, and
[`docs/pitch-deck.md`](docs/pitch-deck.md) for the hackathon pitch deck.

## Deployment

Railway (`web` + `worker` services, shared Postgres + Redis). See
[`docs/deploy/railway.md`](docs/deploy/railway.md).

## Docs

| Doc | Purpose |
|---|---|
| [`SPEC.md`](SPEC.md) | Full build spec — pages, endpoints, data models, security controls |
| [`AGENT.md`](AGENT.md) | Stack conventions and security rules (local only, not committed) |
| [`docs/zk.md`](docs/zk.md) | How the real Groth16/Soroban ZK layer works |
| [`docs/demo/runbook.md`](docs/demo/runbook.md) | ~3-minute manual demo script |
| [`docs/deploy/railway.md`](docs/deploy/railway.md) | Railway deployment notes |
| [`docs/features.md`](docs/features.md) | Phase-by-phase changelog |
| [`docs/pitch-deck.md`](docs/pitch-deck.md) | Hackathon pitch deck |

## What's not yet wired

New private-payment *submission* still needs a deployed `shielded_transfer`
privacy-pool contract behind the same interface as the ZK verifier — proof
**verification** is fully live on testnet, but creating a brand-new shielded
payment (beyond the seeded demo one) is not yet end-to-end on-chain. See the
"What's next" slide in [`docs/pitch-deck.md`](docs/pitch-deck.md).

# Demo dataset & credentials (#107)

`pnpm db:reset` drops → re-migrates → reseeds the database with a **deterministic,
offline, rich demo dataset** so every screen looks real in a demo. `pnpm db:seed`
re-applies just the demo rows idempotently (no reset).

```bash
pnpm db:reset          # destructive: drop + migrate + seed (guarded against NODE_ENV=production)
pnpm db:seed           # idempotent re-seed of the demo rows only
```

The reset refuses to run when `NODE_ENV=production` unless `ALLOW_DB_RESET=true`
(or `--force`) is set — it wipes all data.

## Logins

| Role | Username / email | Password | Notes |
|------|------------------|----------|-------|
| **ADMIN** | `admin` | `$SEED_ADMIN_PASSWORD` (from `.env`) | sees `/reports`, `/admin`, everything |
| **MEMBER** | `member` | `demo-member-pass-2026` | standard tenant user (no `/reports`) |
| **Receiver** | `maria@freelance.demo` | `demo-maria-pass-2026` | freelancer — has a claimed wallet disbursement |
| **Receiver** | `jose@freelance.demo` | `demo-jose-pass-2026` | freelancer — has a claimed wallet disbursement |
| **Receiver** | `ana@freelance.demo` | `demo-ana-pass-2026` | freelancer — has a claimed bank disbursement |

> Passwords are argon2id-hashed in the DB — **never stored in plaintext**. They are
> printed to the seed log and listed here only. Override the member/receiver
> passwords via `SEED_MEMBER_PASSWORD` etc. if desired.

## What the seed creates (tenant "Trexure HQ")

- **View key** (so `/decrypt` round-trips) + a mock-anchor `AnchorConfig`.
- The **Demo Replay sample payment** (unchanged — `intent_seed_demo_...`).
- **14 demo payments** (`intent_demo_*`) spread across ~40 days, covering **every
  `PaymentStatus` and both rails**, each internally consistent (legs + receipt
  match the status):
  - `SETTLED` **fiat** (USD→PHP) ×2 — ONCHAIN + FIAT legs + a fiat `Receipt`.
  - `SETTLED` **pool-wallet** (XLM→XLM) — ONCHAIN leg + a `pool-wallet` `Receipt`.
  - `SETTLED` **pool-bank** (XLM→PHP) — ONCHAIN + FIAT legs + a fiat `Receipt`.
  - Exceptions: `PENDING`, `ONCHAIN_CONFIRMED` (**on-chain-leg-without-fiat
    drift**), `RECONCILING`, `FAILED` (**pool-bank funds-in-custody**), `DRAFT`.
- A **`PaymentBatch`** with **5 child disbursements** — 3 **claimed** (2 wallet +
  1 bank, linked to the receivers, settled) and 2 **unclaimed** (`PENDING`).
- **AuditLog** rows (`auth.login`, `viewkey.decrypt`, `report.generate`).

## Determinism

Fixed IDs + a fixed clock (`SEED_BASE_DATE`, default `2026-07-08`; **never**
`Date.now()`) + plausible offline tx hashes/bank refs — so runs are reproducible
and need no live testnet. Spread across ~2 months so the date-range reports have
data. For a live demo anchored to today, set `SEED_BASE_DATE` to the current date.

## Verify it demos well

After a reset, as **admin**: `/reports` shows a reconciliation statement with
several settled rows + several exceptions + non-zero PHP/XLM totals; open a
settled payment to see both legs, a decryptable payload, and a receipt; the batch
(`/pool/batches`) shows the claimed-vs-unclaimed split. Log in as **maria** at
`/claim/login` to see the receiver side.

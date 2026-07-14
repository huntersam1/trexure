# Trexure Demo-Day Runbook (≈3 minutes)

**Subject:** one payment's lifecycle — a **$2,500 USD → PHP private payroll payout to a Filipino contractor** — walked through four states. Mock Anchor stands in for Xendit; everything downstream of the webhook is real.

> **Two rails now (#59).** This runbook is **Act 1 — the reconciliation rail**
> (shielded payout ↔ fiat, the main story). There is now a second, live rail:
> **Act 2 — Private on-chain transfer**, where **real XLM moves on Soroban testnet
> with the sender↔recipient link hidden in zero knowledge**. Its ≈90s script is
> [`pool-rail-demo.md`](pool-rail-demo.md); a one-command version is `pnpm pool:demo`.
> Run Act 1 for the business story, Act 2 for the "real crypto, provably private"
> finish.

## Pre-flight (before you present)
- `docker compose up -d` (or confirm Railway is live and `GET /api/health` → `"ok"`).
- Local: `pnpm db:seed` then `pnpm dev` + `pnpm worker:dev` (or `pnpm worker:prod`). The seed creates the sample shielded payment (on-chain leg present, NO fiat leg) so beats 1–2 are ready instantly.
- **For a bulletproof "is that a real tx?" answer (#45):** seed with `SEED_ONCHAIN=true pnpm db:seed` (needs a funded `STELLAR_SOURCE_SECRET`). The sample payment's on-chain leg is then a REAL, explorer-linkable `shielded_transfer` testnet tx instead of a `demo_tx_…` placeholder — Demo Replay reconciles against the genuine hash. Without the flag (or the key), it falls back to the offline placeholder so the demo still works with no network.
- Log in as `admin`. Open the dashboard; confirm the **Demo Replay** button is enabled.
- Open the sample payment `/payments/[id]` in a second tab (for the manual fallback).

## The 3-minute script
1. **Login / open** as `admin` (or start already authenticated). *(10s)*
2. **Beat 1 — Public Ledger View (the Shield).** Open the sample payment. Show the block-explorer card: no sender, no receiver, no amount — only a verified **proof hash** + gold `Shielded` badge. *"This is all a competitor scraping the public Stellar ledger can see."* *(25s)*
3. **Beat 2 — Internal Enclave (Decryption).** Click **Apply View Key** → `POST /api/payments/[id]/decrypt`. The shielded blob animates open (blur→clear) to reveal sender, recipient, USDC, and $2,500. *"The company holds its own view key — the key never leaves the server and is never shown."* *(30s)*
4. **Beat 3 — Auto-Reconciliation (the Webhook).** Click **Trigger Payout** → `POST /api/mock-anchor/payout` with the payment's `intentId`. After a visible `delayMs`, the Mock Anchor fires an HMAC-signed `payment.completed` at the real `/api/webhooks/fiat`; the worker matches both legs on `intentId` and flips `status → SETTLED`. Watch the `ReconciliationRow` line-draw stitch on-chain hash ↔ bank ref; badge goes Pending → Settled. *"The moment the peso payout lands, we automatically prove on-chain hash X produced bank deposit Y."* *(45s)*
5. **Beat 4 — The "Stripe" Receipt.** The `ReceiptPanel` renders the unified receipt (§6.4): FX rate, network + anchor fees, slippage, both references, privacy block. Expand the raw JSON drawer; hit **Copy JSON** and **Export PDF**. *"This is what their accounting team and QuickBooks actually want — the blockchain is abstracted away."* *(40s)*
6. **The moat (one line).** *"Stellar-native, ZK-private, locally reconciled — no incumbent does all three."* *(20s)*

## One-click fallback: Demo Replay
If manual steps misfire, hit **Demo Replay** on the dashboard (or the sample payment page). It runs all four beats automatically with paced transitions: idempotent reset of the sample payment's fiat leg + receipt → decrypt → mock-anchor payout (visible delay) → poll until SETTLED → reveal receipt. It is idempotent and can be run repeatedly.

## Optional: failure-path (strong for judges)
Trigger `POST /api/mock-anchor/payout` with `fail:true` → the payment moves to **FAILED** (red, with a **Retry Reconcile** affordance on the payment page). Click **Retry Reconcile** (`POST /api/payments/[id]/retry-reconcile`); because FAILED is terminal, recovery runs through the demo reset and a successful payout to reach SETTLED. Shows the system handles real-world failed payouts.

## Graceful degradation (if ZK integration is partial — SPEC §14.5)
Keep beats 1–2 visually real from the stored `encryptedPayload` + a real on-chain proof-verification call (or the clearly-labeled Groth16-verifier fallback). Narrate the privacy layer as "shipped on testnet." Beats 3–4 (reconciliation + receipt) are ALWAYS fully live — they carry the demo regardless. NEVER present a mocked proof *verification* as real.

## Act 2 — Private on-chain transfer (live shielded pool, #59)

The second half of the pitch: **real value moves privately on-chain.** Full script
+ proof points in [`pool-rail-demo.md`](pool-rail-demo.md). The 30-second version:

- **Enable it** (off by default): `ENABLE_POOL_RAIL=true pnpm dev` → a **Private Transfer** link appears (`/pool`). Needs a funded testnet `STELLAR_SOURCE_SECRET`.
- **One-click:** on `/pool`, hit **Run demo** → the app deposits 10 XLM, then withdraws to a **brand-new** address using only a secret note. Both txs link to stellar.expert; the withdraw envelope shares **no account** with the deposit.
- **Or zero-click:** `pnpm pool:demo` → prints both tx links + `✅ POOL DEMO PASSED — real XLM moved A→pool→B, unlinkable, double-spend blocked.`
- **The claim:** a genuine deposit→withdraw on a **deployed Soroban contract** (`CB5FU3DBINAZXGT3KG3BIHXWA4SKN6VQUTJSBRBN4VHQBV2IIE7RLZT4`) with an on-chain Merkle tree + nullifier set and an **in-contract Groth16 proof** — sender↔recipient unlinkable, double-spend blocked.
- **Be honest:** testnet, demo-grade trusted setup, 16-leaf anonymity set, server-signed. See the `pool-rail-demo.md` "what's real vs demo-grade" table.

> This is the milestone older decks called "next." It's shipped: Trexure's
> earlier on-chain leg only **verified** a proof (no tokens moved); this rail
> **moves real value** privately, on a separate, self-contained pool.

## Act 3 — Employee / HR payroll (#133/#134/#135)

Pre-recorded walkthrough: [`trexure-hr.mp4`](trexure-hr.mp4) — one continuous
admin flow, ~50s. Re-record with `pnpm demo:record:hr` (needs `pnpm dev` +
seeded DB + `ENABLE_POOL_RAIL=true` + a funded `STELLAR_SOURCE_SECRET`; the
payout steps settle on testnet).

- **Onboard** an employee with a base salary **and** a convertible non-monetary
  benefit (e.g. a "Wellness allowance").
- **Salary advance:** show the pro-rated *eligible-now* figure, request an
  advance, **approve & pay** it through the pool rail, then **Run salary payout**
  — the advance is netted FIFO and marked **repaid**.
- **Non-monetary → cash:** convert part of the benefit, **approve & pay** — the
  balance decrements and the conversion shows **disbursed** with a linked payment.

## Act 4 — Treasury Float Yield (#161)

Pre-recorded walkthrough: [`trexure-yield.mp4`](trexure-yield.mp4) — one
continuous admin flow, ~23s. Re-record with `pnpm demo:record:yield` (seeds a
demo scenario, then records; needs `ENABLE_YIELD=true pnpm dev`).

- **Treasury Yield dashboard** (`/yield`): idle balance between funding and
  disbursement is swept into **YLDS** and unwound at payout — the float **earns**
  instead of sitting idle. KPIs: **in-yield balance**, **accrued yield**, and the
  **effective APY**; plus active / unwound / buffer-fallback counts and net-to-you.
- **Enable + configure** yield (min idle buffer kept liquid, sweep threshold,
  platform fee in bps) — a real, persisted, ADMIN-gated settings action.
- **Yield Attribution report** (`/reports/yield`): the per-position split —
  principal swept, yield accrued, platform management fee, and **net attributed to
  the tenant** — with CSV/PDF export for accounting. Liquidity is sacred: a failed
  unwind falls back to the liquid buffer (surfaced as a reconciliation exception).

## Beat → feature map (SPEC §14.6)
| Beat | Backed by |
|---|---|
| 1. Public ledger "shield" | `Payment.encryptedPayload` + `proofHash`; `PublicLedgerView` |
| 2. Apply view key → true payload | `POST /api/payments/:id/decrypt`; `EnclavePanel`; `ViewKey` (server-side AES) |
| 3. Trigger payout → auto-reconcile | `POST /api/mock-anchor/payout` → `/api/webhooks/fiat` → `reconcile` worker → `SETTLED` |
| 4. Unified Stripe-style receipt | `Receipt.json` (§6.4); `ReceiptPanel`; `GET /api/payments/:id/receipt` |
| Replay / Failure path | Demo Replay controller (Task 2); `fail:true` + `retry-reconcile` (Task 3) |

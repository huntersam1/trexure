# Trexure — Hackathon Pitch Deck

---

## Slide 1: Title

# Trexure
### A unified treasury API that makes private Stellar payments accounting-ready.

**Team:** [TEAM NAME — placeholder]
**Built on:** Stellar / Soroban testnet
**Stack:** Next.js 16 · React 19 · Prisma 7 · BullMQ · Groth16 ZK

![Placeholder: Trexure logo / wordmark on Plum + Gold brand background](placeholder-image.png)

**Speaker notes:** Hi, we're [team name], and we built Trexure — a treasury API for Stellar. In three minutes we'll show you a private $2,500 payroll payment that's invisible on the public ledger, gets decrypted with the company's own key, auto-reconciles against a real bank payout, and turns into a receipt your accountant could drop straight into QuickBooks. Everything you're about to see is running against a real Stellar testnet stack, not a slide animation.

---

## Slide 2: Problem

- Crypto rails (Stellar included) are **public by default** — every payroll run, vendor payment, or B2B transfer is readable by anyone watching the chain.
- Privacy tech that *does* exist (ZK shielding, mixers) stops at "the transaction is hidden" — it doesn't reconcile against the real-world fiat leg or produce anything a finance team can use.
- Companies that want to pay contractors or vendors in stablecoins are stuck choosing between **transparency they don't want** and **privacy tooling with no operational layer on top** (no reconciliation, no audit trail, no receipts).

**Speaker notes:** Imagine a company running payroll over Stellar for contractors abroad. Every payment — the amount, the recipient, the timing — sits in plain text on a public ledger, visible to competitors, contractors comparing notes, anyone. The privacy tools that exist solve hiding the transaction, full stop. They don't tell finance "this on-chain transfer became this bank deposit," and they definitely don't generate something an accountant can file. That gap — private payment in, clean reconciled receipt out — is what we built Trexure to close.

---

## Slide 3: Solution

**Trexure decrypts a company's own ZK-shielded Stellar payments with its view key, automatically reconciles the on-chain leg against the real-world payout, and emits a Stripe-style receipt.**

- **Shield:** payments post to Stellar as an encrypted payload + Groth16 zero-knowledge proof commitment — the public ledger sees noise, not payroll.
- **Reconcile:** a background worker matches the on-chain leg against an incoming signed fiat/anchor webhook by `intentId`, automatically, with idempotency and failure recovery.
- **Receipt:** the matched payment renders as a clean JSON + branded PDF receipt — FX rate, fees, both references, privacy block — exportable for accounting.

**Speaker notes:** One sentence: we decrypt your own private Stellar payments, reconcile them against the real payout automatically, and hand you a receipt. Three differentiators nobody else combines: genuine on-chain privacy via a real Groth16 proof, not a mock; a reconciliation worker that does the unglamorous, hard-to-fake work of matching two independent event streams; and an output format designed for humans in finance, not block explorers.

---

## Slide 4: Demo

**Core flow — one payment's life, on the dashboard:**

1. **The Shield** — open the sample payment; the public ledger view shows only a gold "Shielded" badge and a proof hash. No sender, no recipient, no amount.
2. **Apply View Key** — click once; the encrypted payload decrypts server-side (AES-256-GCM) and reveals sender, recipient, asset, and amount. The key never reaches the browser.
3. **Trigger Payout** — a Mock Anchor (standing in for a real provider like Xendit) fires an HMAC-signed webhook; the BullMQ worker matches it to the on-chain leg by `intentId` and flips the payment to `SETTLED`.
4. **Receipt + Export** — a §6.4-spec receipt renders in the dashboard; **Export PDF** produces a real, branded, accounting-ready PDF via signed URL.
5. **Bonus — Prove it on-chain:** a Groth16 proof is regenerated and verified live against the deployed Soroban testnet verifier contract, with a tampered-statement check shown failing.

A one-click **Demo Replay** button runs all of this automatically, idempotently, on the seeded sample payment.

![Placeholder: screenshot of the dashboard mid-replay, showing the Shielded badge transitioning to a revealed payload](placeholder-image.png)

[DEMO VIDEO: `docs/demo/trexure-demo.mp4` (committed) — screen recording of the payment lifecycle (login → shield → apply view key → trigger payout → auto-reconcile → receipt → real on-chain Groth16 proof verify against the deployed Soroban testnet contract), ~35s. Re-record anytime with `pnpm demo:record` against a running local stack (see `scripts/record-demo.mjs`) if the UI changes.]

**Speaker notes:** Let's watch it happen. I'm hitting Demo Replay on the dashboard. First beat — the public view, nothing readable. Second — I apply our view key, and the real payload appears: contractor, USDC, $2,500. Third — I trigger the payout, and watch the reconciliation row stitch the on-chain hash to the bank reference in real time, no human in the loop. Fourth — here's the receipt, and I can export it as a PDF right now. And if a judge wants proof this isn't smoke and mirrors, I can click "Verify proof on-chain" and we'll watch a real zero-knowledge proof get checked by a smart contract on Stellar testnet, live.

---

## Slide 5: How it works

**Three Railway-deployable services, one Postgres, one Redis:**

| Service | Role |
|---|---|
| `web` (Next.js 16, RSC) | UI + API routes: auth, payments, receipts, webhook ingestion |
| `worker` (BullMQ consumer) | Polls Soroban RPC for on-chain events, matches fiat webhooks, writes `SETTLED`, generates receipts |
| Postgres 17 / Redis | Source of truth / queue + idempotency cache |

**Data flow:** `POST /api/payments` → Soroban tx submitted via `@stellar/stellar-sdk` → encrypted payload + ZK proof commitment stored → Mock Anchor fires a signed webhook → HMAC-verified → worker reconciles both legs by `intentId` → `SETTLED` → receipt generated.

**ZK layer [confirmed in code]:** a Circom circuit compiled for BLS12-381, proved with `snarkjs` (Groth16), verified on-chain by a hand-written Soroban smart contract (`zk/verifier/src/lib.rs`) using the host's native BLS12-381 pairing functions — not mocked.

**Other real plumbing:** AES-256-GCM payload encryption, argon2id auth, CSRF double-submit, multi-tenant row isolation via a Prisma extension, RFC-9457 problem+json errors, server-side PDF generation (pdfkit), 11 Prisma models, 192 passing automated tests across 58 files.

![Placeholder: architecture diagram — web/worker/Postgres/Redis boxes with Stellar testnet and Mock Anchor as external systems](placeholder-image.png)

**Speaker notes:** Under the hood it's a fairly standard modern stack — Next.js, Prisma, BullMQ — doing two genuinely hard things well. One: the privacy layer is a real Circom circuit, proved with snarkjs, and verified by a Soroban smart contract we wrote ourselves that does actual BLS12-381 pairing checks on-chain — that part took real cryptography work, not a flag we flipped. Two: the worker reconciles two independent, asynchronous event streams — chain events and fiat webhooks — which is the unglamorous but critical part every crypto-payout product hand-rolls badly or skips. We have 192 passing tests covering both.

---

## Slide 6: Impact / market

- **Who needs this:** any company paying contractors, vendors, or cross-border payroll in stablecoins who doesn't want every transaction amount and counterparty exposed on a public ledger — starting with the USD→PHP remittance/payroll corridor we demo.
- **Why now:** stablecoin payroll and B2B payments are growing fast, but the tooling stops at "send the transaction" — nothing in the ecosystem closes the loop from private on-chain transfer to an actual accounting record.
- **Why Trexure specifically:** Stripe and traditional payment APIs can't touch crypto or privacy; existing crypto privacy tooling stops at the chain and produces nothing finance teams can use. We're the only piece that does **Stellar-native + ZK-private + locally reconciled**, together, in one API. [inferred — competitive positioning, not benchmarked against named competitors]

**Speaker notes:** Anyone running payroll or vendor payments over Stellar in stablecoins is the immediate buyer — and that's a fast-growing category as remittance and cross-border payroll move on-chain for the cost savings. The reason this matters strategically: Stripe can't do crypto or privacy, and crypto-native privacy tools stop at "the transaction is hidden" with no operational layer. Nobody combines genuine on-chain privacy with automatic reconciliation and an accounting-ready receipt — that combination is the wedge.

---

## Slide 7: What's next

- **Full privacy-pool transfer contract** — the deployed contract now exposes a live `shielded_transfer` entrypoint (a commitment recorder: it anchors each new payment's intent + commitment as a contract event, confirmed end-to-end on testnet). What remains for a production privacy pool is actual on-chain value transfer with note-based shielded balances and nullifiers.
- **Richer ZK circuit** — current circuit proves a minimal commitment relation; a production privacy pool needs note-based shielded balances and nullifiers.
- **Real anchor integration** — swap the Mock Anchor for a live provider (e.g. Xendit) behind the same signed-webhook contract it already implements.
- **Multi-asset / multi-corridor support** — today's demo is USD→PHP; the schema and reconciliation worker are corridor-agnostic and ready to extend.
- **Admin/ops hardening** — broader audit-log surfacing, key rotation UX, and production secret management for the Railway deploy.

**Speaker notes:** We were deliberate about build order — we shipped the hard, easy-to-fake parts for real: the privacy proof and the reconciliation engine. New payments now submit on-chain for real — a live contract records each payment's commitment and our watcher settles from the contract event. What's left is mostly integration breadth, not new invention: upgrading the commitment recorder to a full privacy pool that moves value, swapping in a live anchor, and broadening past one currency corridor.

---

## Slide 8: Team / thanks

**[TEAM NAME — placeholder]**

- [Name] — [Role] — [contact]
- [Name] — [Role] — [contact]
- [Name] — [Role] — [contact]

Built for [HACKATHON NAME — placeholder] on Stellar testnet.

**Thank you — questions welcome.**

![Placeholder: team photo or logo lockup](placeholder-image.png)

**Speaker notes:** That's Trexure — a real zero-knowledge proof verified on-chain, a real reconciliation engine, and a receipt finance teams can actually use, all running on Stellar testnet today. Thanks for watching, we'd love your questions, and we're happy to walk through the code or the contract live if you want to dig in.

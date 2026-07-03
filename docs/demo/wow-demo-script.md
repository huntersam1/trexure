# Wow Demo — Narration Script (≈36s video)

Read this over [`trexure-wow-demo.mp4`](trexure-wow-demo.mp4) — recorded from
the merged `develop` (real Groth16 proving by default #46, real seeded on-chain
leg #45). Timecodes match the video's beats; red rings mark every click. Pace:
conversational but brisk — the whole read is ~110 words.

> **Re-record anytime** (from `develop`): `SEED_ONCHAIN=true pnpm db:seed`, grab
> the txHash from the seed log, then with `pnpm dev` + `pnpm worker:dev` running:
> `SEED_ADMIN_PASSWORD=… DEMO_TX_HASH=<hash> node scripts/record-wow-demo.mjs`.
> stellar.expert takes ~20s to hydrate — trim the blank gap in post
> (this cut: keep `[0, 27.1s)` + `[49.0s, end]`, freeze last frame +4s).

---

**[0:00 – 0:04] — Login**

> "This is Trexure — a treasury API for Stellar. I'm signing in as a company's finance admin."

**[0:04 – 0:10] — Open the payment / public ledger view**

> "Here's a twenty-five-hundred-dollar contractor payment. On the public ledger? Nothing. No sender, no recipient, no amount — just a proof hash."

**[0:10 – 0:13] — Apply View Key** *(red ring on the click)*

> "One click applies our own view key — decrypted server-side. Contractor, USDC, twenty-five hundred."

**[0:13 – 0:18] — Verify proof on-chain** *(red ring on the click)*

> "Is the proof real? We verify a genuine zero-knowledge proof against a smart contract on Stellar testnet — live. Verified."

**[0:18 – 0:27] — Trigger payout → auto-reconcile → receipt** *(red ring on the click)*

> "Now the payout. Watch the matching engine stitch the on-chain hash to the bank reference — no human in the loop. Settled — and there's the receipt: one-forty-one-thousand-seven-fifty pesos, accounting-ready."

**[0:27 – 0:36] — The same transaction on stellar.expert**

> "And here's that exact transaction on Stellar's public explorer — successful, real, on-chain. Private in, receipt out. That's Trexure."

---

## Beat-by-beat: what's on screen

| Time | On screen |
|---|---|
| 0:00–0:04 | Login page → Sign in (ring) → Treasury Overview |
| 0:04–0:07 | Payments table → sample payment opens (ring) |
| 0:07–0:10 | Public Ledger View: gold **Shielded** badge + proof hash only |
| 0:10–0:13 | **Apply View Key** (ring) → payload decrypts: Trexure HQ → Contractor (Manila), USDC 2500.00 |
| 0:13–0:18 | **Verify proof on-chain** (ring) → "Proof verified on Stellar testnet" |
| 0:18–0:24 | **Trigger Payout** (ring) → Auto-Reconciliation: on-chain leg (real tx `d7e20c08…2a2d5b`) ↔ fiat leg, matching engine |
| 0:24–0:27 | **MATCHED 1:1** → SETTLED → receipt: Payment Confirmed, **141750.00 PHP**, bank ref `PH-BANK-A89142A3` |
| 0:27–0:36 | **stellar.expert (testnet)**: the same tx — Status **Successful**, ledger 3395645, `shielded_transfer("intent_seed_demo_usd_php_0001", "2500.00", "USDC", <commitment>)` invoked on the verifier contract, centered |

**The kicker if a judge asks "is that real?":** the tx hash on the reconciliation
row and the hash on stellar.expert are the same 32 bytes — a genuine
`shielded_transfer` submitted to the deployed Soroban contract at seed time
(`SEED_ONCHAIN=true`, #45), and the Groth16 verification is a real BLS12-381
pairing check on-chain (#26/#46) — both merged to `develop`. The only mock in
the video is the fiat anchor, which fires the same HMAC-signed webhook a real
provider would.

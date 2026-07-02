# Trexure — 2–3 Minute Demo Video Script

A paced voiceover script for a **2–3 minute** walkthrough that shows the product
working end-to-end **and clearly explains what the zero-knowledge layer is doing**.
Unlike the 36-second teaser ([`wow-demo-script.md`](wow-demo-script.md)), this one
slows down on two screens — the shield and the on-chain proof verification — so a
non-technical viewer actually understands the ZK part.

## How to use this
- **Record your voice** reading the **Voiceover** column while screen-recording the
  live app in the order of the **On screen** column (or narrate over a screen
  capture — see below). You do **not** need to be on camera.
- **Regenerate the silent screen capture** (from merged `develop`):
  ```bash
  docker compose up -d
  SEED_ONCHAIN=true pnpm db:seed      # real testnet on-chain leg (#45); omit for offline placeholder
  pnpm dev            # web
  pnpm worker:dev     # worker (second terminal)
  SEED_ADMIN_PASSWORD=… pnpm demo:record docs/demo/trexure-demo.mp4
  ```
  The capture uses fixed pauses (~45–60s of motion). For a 2–3 min video, either
  (a) narrate over it with natural pauses / a freeze-frame on the shield + verify
  screens, or (b) bump the `pause(page, …)` values in `scripts/record-demo.mjs`
  (especially around the Public Ledger View and "Verify proof on-chain") so the
  motion matches the narration.
- **No voice?** Use the **Caption** lines at the bottom as burned-in on-screen text.

**Target length:** ~2:45. Narration is ~430 words — read conversationally, unhurried.

---

## The script (scene by scene)

### 1 · Hook + the problem — `[0:00–0:20]`
**On screen:** Landing page (`homepage/index.html`) or the login screen, then sign in as `admin` → Treasury Overview dashboard.

> "This is **Trexure** — a treasury layer for the Stellar blockchain. Here's the problem it solves. If a company runs payroll on a public blockchain, anyone can scrape the ledger and see exactly who they paid and how much. But if they hide it, their *own* finance team can't reconcile it or hand it to their accountant. Privacy and bookkeeping usually cancel each other out. Trexure gives you both. Let me show you a single contractor payment go all the way through."

### 2 · The shield — what the world sees — `[0:20–0:45]`
**On screen:** Open the sample payment → **Public Ledger View**: the gold **Shielded** badge and a **proof hash**, with no sender / recipient / amount.

> "This is a twenty-five-hundred-dollar payment to a contractor in Manila. And this is everything the public Stellar ledger reveals about it: **nothing.** No sender, no recipient, no amount — just this one value, a *proof hash*. A competitor scraping the chain sees noise. So how does the company itself read its own payment? Two ways — and this is where the zero-knowledge part comes in."

### 3 · Apply the view key (decrypt) — `[0:45–1:05]`
**On screen:** Click **Apply View Key** → the shielded blob animates open to the real payload (Trexure HQ → Contractor · USDC · 2,500.00).

> "First, the company holds its **own view key**. One click decrypts the payment — but notice this happens **server-side**; the key never touches the browser and is never logged, and every decrypt is written to an audit log. Now *they* can see the real payload — for their books, or to show a regulator — while the public chain still shows nothing."

### 4 · What the ZK proof actually is — `[1:05–1:45]`  ⟵ the explainer beat
**On screen:** Hold on the proof hash / the "Verify proof on-chain" button. (Optional: briefly show `docs/zk.md` or the `zk/verifier` contract.)

> "So the payment is hidden. But how does anyone *trust* it's a real, well-formed payment and not garbage? That's the zero-knowledge proof. A zero-knowledge proof lets you prove a statement is true **without revealing the secret behind it.** Here, the company proves it knows the secret that 'opens' this commitment — that this shielded blob is a genuine payment it controls — **without putting any payment details on-chain.** The only public thing is that proof hash. The proof itself is a real **Groth16** proof over the **BLS12-381** curve, and it's verified by a **Soroban smart contract running a real pairing check on-chain.** Watch."

### 5 · Verify the proof on-chain — `[1:45–2:05]`
**On screen:** Click **Verify proof on-chain** → "**Proof verified on Stellar testnet**".

> "That just sent the proof to our verifier contract on Stellar testnet and got back a live 'verified.' No trusted middleman — a smart contract did the math. And if anyone tampers with the statement, the same check returns **false.** So: the payment stays private, but its validity is publicly, cryptographically checkable."

### 6 · Auto-reconcile → the receipt — `[2:05–2:35]`
**On screen:** Click **Trigger Payout** → Auto-Reconciliation stitches the on-chain leg to the fiat/bank reference → **SETTLED** → the Stripe-style receipt (141,750.00 PHP, FX rate, fees, bank ref).

> "Last step — the money. The peso payout lands and fires a signed webhook, and a background worker automatically matches the on-chain leg to the bank reference — no spreadsheet, no analyst. **Settled.** And out drops a clean, Stripe-style receipt: the FX rate, the fees, both references — the thing an accountant or QuickBooks actually wants. The blockchain is completely abstracted away."

### 7 · Proof it's real + close — `[2:35–2:50]`
**On screen:** (Optional) the same tx on **stellar.expert** — Status *Successful*. Then back to the receipt.

> "And that on-chain leg is a real transaction — here it is on Stellar's public explorer. Private payment in, accountant-ready receipt out, with a zero-knowledge proof anyone can verify. That's Trexure."

---

## What's real vs. mocked (say this if a judge asks)
- **Real:** the Groth16 proof + its **on-chain** BLS12-381 verification on Stellar testnet; the shielded payload + server-side view-key decryption; the two-legged reconciliation and the receipt; and — with `SEED_ONCHAIN=true` — the on-chain leg is a genuine `shielded_transfer` testnet transaction whose hash resolves on stellar.expert.
- **Mocked (only this):** the **fiat anchor** — a built-in Mock Anchor fires the *same* HMAC-signed webhook a real provider (e.g. Xendit) would, so it swaps in later with no code change. The FX rate/fee are fixed demo figures.
- **Honest scope:** `shielded_transfer` is a *commitment recorder* (it anchors the payment's commitment on-chain); a full value-moving privacy pool with notes/nullifiers is future work. The proof and its verification are genuinely real.

---

## Caption-only version (if you don't narrate)
Burn these as on-screen text, one per scene, timed to the table above:
1. `Trexure — private payroll on Stellar, with an accountant-ready receipt.`
2. `On the public ledger: no sender, no recipient, no amount — just a proof hash.`
3. `The company's own view key decrypts it — server-side, audit-logged.`
4. `Zero-knowledge: prove the payment is valid WITHOUT revealing it. Groth16 / BLS12-381.`
5. `Verified on-chain by a Soroban smart contract. Tamper → false.`
6. `Payout lands → auto-reconciled → Settled → Stripe-style receipt.`
7. `Real testnet tx. Private in, receipt out. That's Trexure.`

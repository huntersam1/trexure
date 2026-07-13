# Trexure — Voice-Over Scripts for the Demo Clips

Per-clip narration for the six recorded demo videos in this folder. Each script
is **paced to that clip's real runtime** and follows its exact on-screen beats
(the beats come straight from the `scripts/record-*.mjs` recorders).

For the single combined 2–3 minute pitch narration, see
[`video-script.md`](video-script.md); for the 36-second teaser, see
[`wow-demo-script.md`](wow-demo-script.md). This file is the clip-by-clip set.

## How to use
- Read the **Voiceover** line while the matching **On screen** beat is playing.
- **Pace:** target ~**2.5 words/second** (≈150 wpm) — measured, unhurried. Word
  counts below already fit each clip with breathing room, so don't rush; let a
  beat land silently rather than talk over the next one.
- Every clip opens on a login screen (~3–4s of typing). The opener line is
  written to run over that so the meaningful screen gets the substance.
- **No voice?** Burn the single **Caption** line under each script as on-screen
  text.

| Clip | File | Runtime | Words |
|---|---|---|---|
| 1 · Payment lifecycle | `trexure-payment-lifecycle.mp4` | ~27s | ~66 |
| 2 · Batch send | `trexure-batch-send.mp4` | ~35s | ~86 |
| 3 · Claim | `trexure-claim.mp4` | ~23s | ~56 |
| 4 · Payroll register | `trexure-reports.mp4` | ~17s | ~42 |
| 5 · Verifiable audit link | `trexure-audit-link.mp4` | ~21s | ~52 |
| 6 · Employee / HR payroll | `trexure-hr.mp4` | ~48s | ~116 |

Total narrated runtime ≈ **2:51**.

---

## 1 · Payment lifecycle — `trexure-payment-lifecycle.mp4` (~27s)

*One shielded payroll payment walked from public-ledger view → view-key decrypt →
auto-reconciliation → settled receipt. (Offline mock anchor.)*

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:06 | Login → open the sample payment → **Payment Lifecycle** | "Here's a single private payroll payment, start to finish." |
| 0:06–0:12 | Public ledger view: gold **Shielded** badge + proof hash | "On the public Stellar ledger it's shielded — no sender, no recipient, no amount. Just a proof hash." |
| 0:12–0:17 | Click **Apply View Key** → "Decrypted in enclave" reveal | "The company applies its *own* view key — server-side, never in the browser — and the real payment decrypts inside the enclave." |
| 0:17–0:23 | **Auto-Reconciliation** → **Trigger Payout** → row stitches | "Trigger the payout, and the on-chain leg auto-reconciles against the bank reference —" |
| 0:23–0:27 | Badge flips to **Settled** → receipt | "settled, with a clean, accountant-ready receipt. Private in, receipt out." |

> **Caption:** `Shielded on-chain → view-key decrypt → auto-reconciled → settled receipt.`

---

## 2 · Batch send — `trexure-batch-send.mp4` (~35s)

*The paying company sends a private batch payroll to two contractors and gets one
single-use claim note per receiver. (Real testnet deposits.)*

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:07 | Login → **Batch payments** → **New batch** | "Paying a whole team privately — in one batch." |
| 0:07–0:15 | Fill receiver 1: amount, "Alice — July invoice", email | "The company opens a new batch and adds a contractor: Alice, with her amount and a label for the books." |
| 0:15–0:20 | **Add receiver** → fill receiver 2: "Bob — contractor payout" | "Then a second — Bob. Each payout is separate and private." |
| 0:20–0:28 | **Send batch** → "Batch sent" (sequential testnet deposits) | "One click sends the batch. Every payout is a real shielded deposit on Stellar testnet." |
| 0:28–0:35 | Reveal per-receiver notes + bearer warning → **View batch** | "And each receiver gets one claim note. These are bearer credentials — whoever holds the note can claim it — so they're shown exactly once." |

> **Caption:** `One private batch → real shielded testnet deposits → one single-use claim note each.`

---

## 3 · Claim — `trexure-claim.mp4` (~23s)

*The freelancer logs into the separate claim portal and claims their note to their
own wallet via a real ZK withdraw. (Real testnet.)*

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:06 | Open `/claim` → **Receiver access** → sign in | "Now the other side — the freelancer collecting their pay. They sign into a separate claim portal; no company account needed." |
| 0:06–0:13 | **Claim a payment**: paste note → paste `G…` wallet | "They paste the note they were sent and enter their own Stellar wallet address." |
| 0:13–0:20 | **Claim my payment** → real ZK withdraw → tx link | "One click runs a real zero-knowledge withdraw on testnet —" |
| 0:20–0:23 | "— settled · on-chain receipt issued" | "and the money settles to their wallet, with an on-chain receipt. The link back to the sender stays hidden." |

> **Caption:** `Separate claim portal → paste note → real ZK withdraw → settled, sender unlinkable.`

---

## 4 · Payroll register — `trexure-reports.mp4` (~17s)

*The Disbursement / Payroll Register: the flow map traces treasury → batches →
destinations → receivers, then the register table.*

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:06 | Login → **Disbursement / Payroll Register** | "Every payout, reconciled in one register." |
| 0:06–0:12 | **Disbursement flow** map → expand a batch (wallet / bank / pending / failed → receivers) | "The flow map traces each batch out of the treasury — to wallets, to banks, and any pending or failed legs —" |
| 0:12–0:17 | Scroll into stat cards + register table | "and the register below lists every disbursement, ready to hand to the accountant." |

> **Caption:** `Treasury → batches → destinations → receivers, every disbursement reconciled.`

---

## 5 · Verifiable audit link — `trexure-audit-link.mp4` (~21s)

*"Private to the world, provable to your auditor": admin mints a disclosure link
for one settled payment; a logged-out auditor opens it and verifies the proof
on-chain (#128).*

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:04 | Login as admin | "Private to the world — provable to your auditor." |
| 0:04–0:10 | On a settled payment: **Share verifiable link** → link reveals | "From a settled payment, the admin mints a disclosure link, scoped to just that one payment." |
| 0:10–0:16 | Session cleared → open `/verify/<token>` → **Proof of payment** | "We clear the session — now we're an outside auditor with no account. The link shows only that payment." |
| 0:16–0:21 | **Verify on-chain** → "Verified on Stellar testnet" ✓ | "Anyone can verify the proof live on Stellar testnet. Green check — genuinely settled." |

> **Caption:** `Mint a scoped disclosure link → a logged-out auditor verifies the proof on-chain.`

---

## 6 · Employee / HR payroll — `trexure-hr.mp4` (~48s)

*One continuous admin flow: onboard (salary + a convertible non-monetary benefit)
→ salary advance (request → approve & pay → run payout, netted & repaid) →
non-monetary → cash conversion. (Approve/pay steps settle on the real pool rail.)*

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:08 | Login → **Employees** → **Onboard employee** | "Trexure also runs the whole employee payroll cycle. The admin onboards a new employee, Maria." |
| 0:08–0:20 | Fill name/email, base salary (40 XLM), **Add item** → "Wellness allowance", notional 200, mark **convertible** | "A base salary — and a non-monetary benefit, a wellness allowance, flagged as convertible to cash." |
| 0:20–0:27 | Employee detail → package card → **Salary advance** eligibility tiles | "Payday hasn't come yet, but she can draw earned wages early. Trexure shows exactly how much is eligible right now." |
| 0:27–0:35 | Request advance (3) → **Approve & pay** → "disbursed" | "She requests an advance; the admin approves and pays it — disbursed through the private pool rail, on-chain." |
| 0:35–0:41 | **Run salary payout** → "Salary paid" → advance "repaid" | "When payroll runs, that advance is automatically netted out, first-in-first-out, and marked repaid — no manual tracking." |
| 0:41–0:48 | **Convert benefits to cash** (50) → **Convert & withdraw** → **Approve & pay** → "disbursed" | "Finally she converts part of that benefit into cash — approve and pay, disbursed on the same rail. Earned-wage access and benefit-to-cash, built in." |

> **Caption:** `Onboard → draw earned wages early → auto-netted at payroll → convert benefits to cash.`

---

## What's real vs. mocked (say if asked)
- **Real:** the shielded payload + server-side view-key decryption; the batch
  deposits and the claim **ZK withdraw** on Stellar testnet; the two-legged
  reconciliation and receipt; the on-chain **Groth16 / BLS12-381** proof
  verification behind the audit link; and the HR advance/conversion payouts,
  which settle on the live **pool rail** on testnet.
- **Mocked (only this):** the **fiat anchor** in the payment-lifecycle clip — a
  built-in Mock Anchor fires the *same* HMAC-signed webhook a real provider
  (e.g. PDAX) would, so it swaps in later with no code change. FX rate/fee are
  fixed demo figures.

## Re-recording the clips
Each clip has a recorder script (see `package.json`):
`demo:record:lifecycle` · `demo:record:batch` · `demo:record:claim` ·
`demo:record:reports` · `demo:record:audit` · `demo:record:hr`. If you change a
recorder's pacing, re-check the timings above. Full setup is in
[`runbook.md`](runbook.md).

# Trexure — Pitch Deck Presenter Script

Spoken narration for presenting **`Trexure-Deck`** (13 slides). One block per
slide, in order, paced for a **~6½ minute** live pitch. Read the **Script** line
conversationally (~2.5 words/sec); the *(Deliver)* notes are stage directions,
not spoken.

Slides 5–9 are the walkthrough — either present live or **play the recorded
clip** noted for each. Per-clip narration is in
[`voiceover-scripts.md`](voiceover-scripts.md); full pitch-narration variants are
in [`video-script.md`](video-script.md) (2–3 min) and
[`wow-demo-script.md`](wow-demo-script.md) (36s teaser).

**Total:** ~13 slides · ~6:30 · ~1,000 words.

---

### Slide 1 · Title — *"Trexure · Unified Treasury Layer for Stellar"* — `[~0:20]`
> "This is **Trexure** — a unified treasury layer for the Stellar blockchain. In one sentence: **private payments and audit-ready reports**, built for companies paying contractors and teams. Today, on a public chain, you have to choose between privacy and bookkeeping. Trexure gives you both."

*(Deliver: land the name, then the one-liner. Don't rush the promise.)*

---

### Slide 2 · Key Features — *"One treasury layer, four core capabilities"* — `[~0:30]`
> "Everything Trexure does sits on four pillars. **One — private payments:** shielded single and batch transfers, ideal for payroll. **Two — off-ramp and reconcile:** cash out to fiat and auto-match the on-chain leg to the settlement. **Three — audit-ready reporting:** FX, fees and references, exportable. And **four — the newest:** employee **cash-advance and benefit-to-cash conversion** — earned-wage access, paid and reconciled on the same rail. Let me show you why this matters."

*(Deliver: this is the map of the whole deck — point to each quadrant. Optionally cue `trexure-hr.mp4` here for pillar 4.)*

---

### Slide 3 · The Problem — *"Wallet payments leak everything you'd never share"* — `[~0:40]`
> "Here's the problem. **First, payments are public by default** — on a public ledger, every amount and every counterparty is out in the open for anyone to scrape. **Second, salaries get exposed** — your co-worker can see your pay, and you can see theirs. Payroll on a transparent chain is a non-starter. **And third**, from the company's side, matching those on-chain flows back to the books for an audit is a manual, error-prone headache. Privacy and bookkeeping cancel each other out."

*(Deliver: three beats, slow down on "salaries exposed" — it's the visceral one.)*

---

### Slide 4 · The Solution — *"Private to pay, reconciled to report"* — `[~0:40]`
> "Trexure is one layer that does both. It makes a payment **private on-chain** — shielded transfers with a batch mode for payroll, so amounts and recipients stay hidden. It **off-ramps to fiat** through PDAX and **automatically reconciles** the on-chain leg against the settlement — no spreadsheet. And it turns the whole flow into an **accountant-ready receipt**: FX, fees, references, as JSON or PDF. Private to pay, reconciled to report. Let me walk one payment through it."

*(Deliver: this mirrors the three-card structure — private → reconcile → report — the spine of the demo.)*

---

### Slide 5 · Send a private payment — `[~0:30]`  ▶ demo
> "Step one — send. The company creates a payment, single or batch. On the public ledger, all anyone sees is a **commitment** — not who, not how much. Real value moves on Stellar testnet, but the details are shielded."

*(Deliver: **play `trexure-batch-send.mp4`** — or present `/pool` live. Let the "one note per receiver" moment land.)*

---

### Slide 6 · Claim & off-ramp — `[~0:30]`  ▶ demo
> "Step two — the recipient collects. They claim via wallet or bank, from a separate portal — no company account needed. Trexure off-ramps through PDAX and **reconciles both legs automatically**: the moment the payout lands, we've proved on-chain hash X produced deposit Y."

*(Deliver: **play `trexure-claim.mp4`** for the freelancer side, or the reconcile beat of `trexure-payment-lifecycle.mp4`.)*

---

### Slide 7–8 · Generate the report — `[~0:35]`  ▶ demo
> "Step three — the report. Out drops a clean, **Stripe-style receipt** and a full payroll register: every disbursement traced from the treasury out to each wallet and bank, with the FX rate, the fees, and both references. This is the thing an accountant — or QuickBooks — actually wants. The blockchain is completely abstracted away."

*(Deliver: **play `trexure-reports.mp4`**. Slides 7 and 8 are the same beat — hold on one; use the second only as a transition.)*

---

### Slide 9 · Compliance & Audit — *"shield → decrypt → off-ramp → reconcile → receipt"* — `[~0:35]`  ▶ demo
> "And when an auditor needs proof, you don't hand over the vault. From a settled payment you mint a **verifiable disclosure link**, scoped to that one payment. An outside auditor — no account — opens it and verifies the proof **live on Stellar testnet**. Private to the world, provable to your auditor. That's the full arc: shield, decrypt, off-ramp, reconcile, receipt."

*(Deliver: **play `trexure-audit-link.mp4`**. Emphasize "no account" — the auditor is a stranger.)*

---

### Slide 10 · Impact — *"Compliance and privacy — for companies and the network"* — `[~0:45]`
> "So who wins? **For companies:** pay privately by default, disclose selectively when finance or an auditor needs it — the chain disappears behind a familiar treasury workflow. **And for Stellar:** this unlocks enterprise volume — it makes the network viable for payroll and vendor payouts at real scale. It onboards non-crypto finance teams with a Stripe-style API and receipts, and every settled payment moves value through Stellar's anchors and USDC."

*(Deliver: two audiences — company first, then network. This is the "why Stellar cares" slide.)*

---

### Slide 11 · Competitive Landscape — *"No one owns our exact space"* — `[~0:45]`
> "Nobody does what we do. Three camps each solve a *piece*: **stablecoin payroll** — Rise, Toku — but no privacy, no reconciliation. **On-chain ZK privacy** — Railgun, Aleo — shielded transfers, but no reconciliation or receipts. **Crypto accounting** — Cryptio, Bitwave — reconciliation, but they demand full transparency. And critically, **every one of them is off-Stellar.** On Stellar itself there are only experimental primitives, no product. Our moat is the **unclaimed intersection**: private, auto-reconciled, accountant-ready payroll — the one combination no incumbent ships."

*(Deliver: rattle the three camps quickly, then slow down and own the intersection.)*

---

### Slide 12 · Roadmap — *"From hackathon build to production treasury layer"* — `[~0:35]`
> "Where we are and where we're going. **Shipped now:** private payments and batch, wallet and bank claim paths, off-ramp reconciliation and receipts, and employee salary advance plus benefit-to-cash conversion. **Zero to three months:** the real PDAX integration, mainnet-ready, and accounting exports to QuickBooks and Xero. **Then:** confidential balances, FX routing, and selective-disclosure audit views — building toward enterprise and PayFi financing against a proven receipt."

*(Deliver: stress how much is already *shipped* — credibility beat.)*

---

### Slide 13 · Founder / Close — *"Mark Hugh Neri · Artisam Labs"* — `[~0:25]`
> "I'm Mark Hugh Neri, founder of Artisam Labs — fifteen-plus years building enterprise and startup software across blockchain and AI. Trexure is private payment in, accountant-ready receipt out, with a proof anyone can verify — the treasury layer Stellar payroll has been missing. Let's talk."

*(Deliver: warm, direct, end on the invitation. Hold the closing line.)*

---

## One-breath version (elevator, ~20s)
> "Trexure is a private treasury layer for Stellar. Companies pay contractors and run payroll **privately** on-chain, Trexure **auto-reconciles** the off-ramp to fiat and drops out an **accountant-ready receipt** — plus earned-wage advances and benefit-to-cash conversion. Private to pay, reconciled to report — and no one else does all three on Stellar."

## What's real vs. mocked (if a judge asks)
- **Real:** shielded payments + view-key decrypt; batch deposits and the claim **ZK withdraw** on Stellar testnet; two-legged reconciliation and receipts; on-chain **Groth16 / BLS12-381** proof verification behind the audit link; HR advance/conversion payouts settle on the live pool rail.
- **Mocked (only this):** the **fiat anchor** — a Mock Anchor fires the *same* HMAC-signed webhook a real provider (PDAX) would, so it swaps in with no code change. FX rate/fee are fixed demo figures.

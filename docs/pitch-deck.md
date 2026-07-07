# Trexure — Hackathon Pitch Deck

> A private payment walks in. A clean, accounting-ready receipt walks out. The blockchain disappears.

---

## Slide 1: Title

# Trexure
### The private treasury that turns a hidden payment into a receipt your accountant already knows how to file.

**Team:** [TEAM NAME — placeholder]
**Contact:** [team email / handle — placeholder]

![Placeholder: Trexure logo / wordmark on aubergine-black + gold brand background](placeholder-image.png)

**Speaker notes:** Hi, we're [team name], and we built Trexure. In the next three minutes I'll show you a payroll payment that's invisible to anyone watching the public ledger, that the company can still decrypt with its own key, that reconciles itself against a real bank payout, and that comes out the other side as a receipt your accountant could drop straight into their books. Everything you're about to see runs against a real, live backend — not a slide animation.

---

## Slide 2: Problem

- Companies paying people over crypto rails have a brutal choice:
  - **Pay transparently** — every salary, vendor payout, and amount is readable by anyone scraping the public ledger (competitors, nosy contractors, the whole internet).
  - **Pay privately** — the payment disappears, but so does any proof of *which on-chain transfer became which bank deposit*.
- Privacy tooling stops at "the transaction is hidden." It does **not** reconcile that hidden payment against the real-world fiat leg, and it does **not** produce anything a finance team can file.
- So finance teams are stuck: privacy they want, with **no operational layer on top** — no reconciliation, no audit trail, no receipt.

![Placeholder: split visual — public ledger with exposed payroll details vs. a shielded blob with a single proof hash](placeholder-image.png)

**Speaker notes:** Picture a company running payroll over a public blockchain for contractors abroad. Every payment — the amount, the recipient, the timing — is sitting in plain text on a ledger anyone can read. The privacy tools that exist solve *hiding* the transaction, and then they stop. They don't tell finance "this on-chain transfer became this bank deposit," and they definitely don't generate something an accountant can file. That gap — private payment in, clean reconciled receipt out — is the gap we built Trexure to close.

---

## Slide 3: Solution

**Trexure turns a private payment into an accounting-ready receipt — and proves it's the same money, end to end.**

- **Shield it:** the payment details are encrypted; only a cryptographic commitment touches the ledger.
- **Keep your own key:** the company holds a view key and can decrypt its own payments server-side — for AML, KYC, or audit — without ever exposing the key.
- **Auto-reconcile:** when the fiat payout lands, a background worker stitches the on-chain leg to the bank deposit automatically and marks it settled.
- **File it:** the result is one clean, Stripe-style receipt — FX, fees, both references — that pipes straight into accounting software.

![Placeholder: one-line flow — Shielded payment → Apply view key → Auto-reconcile → Stripe-style receipt](placeholder-image.png)

**Speaker notes:** Trexure is one sentence: a private payment in, a clean receipt out, with proof it's the same money end to end. We shield the payment so the public ledger only sees a commitment, not the payroll. We give the company its own key so it can decrypt when it needs to — for audit, for compliance — without that key ever leaving the server. When the real-world bank payout arrives, a worker reconciles the two legs automatically. And the output is a receipt that looks like something Stripe or your bank already sends — not a blockchain explorer.

---

## Slide 4: Demo

**One payment, four beats — a $2,500 USD → PHP payroll payout, live.**

1. **The shield** — public ledger view shows a proof hash and a "Shielded" badge. No payroll details. *(What a competitor scraping the chain can see.)*
2. **The decrypt** — click *Apply View Key*; the encrypted payload opens to reveal sender, recipient, and amount. The key never leaves the server.
3. **The match** — trigger the payout; a signed webhook arrives, the worker matches on-chain ↔ fiat, and the status flips Pending → Settled live.
4. **The receipt** — a Stripe-style card with FX, fees, slippage, both references. Copy JSON or export PDF.

![Placeholder: screenshot of the four-state payment lifecycle view (shield → decrypt → reconcile → receipt)](placeholder-image.png)

[PLACEHOLDER: Demo video — ~60–90s screen recording of the four-beat lifecycle on the seeded sample payment, ending on the receipt with the "Copy JSON" click; record with `pnpm demo:record`]

**Speaker notes:** Here's the whole product in one payment. Beat one: this is all a competitor can see on the public ledger — a proof hash and "Shielded." Beat two: the company applies its own view key and the real payroll appears — the key is used and zeroized, never returned. Beat three: we trigger the payout, a signed webhook comes back, and watch the status flip from Pending to Settled as the on-chain hash is stitched to the bank reference. Beat four: the receipt — FX rate, fees, both references, ready to copy as JSON or export as PDF. The blockchain is now completely out of the picture.

---

## Slide 5: How it works

- **Three moving parts:** a web app, a background worker, and a database.
  - Web app: where payments are created, decrypted, and viewed.
  - Worker: watches for confirmations and matches the two legs when both arrive.
  - Database: the source of truth — encrypted payloads, legs, receipts, audit trail.
- **The reconciliation key:** every payment carries one shared reference id, embedded on *both* sides — so the worker can say "on-chain hash X produced bank deposit Y" with certainty. We never match on amount alone.
- **Privacy that's verifiable:** the on-chain footprint is a cryptographic commitment; the real details live encrypted in our database and unlock only with the tenant's view key. The proof itself is checked by a real on-chain verifier — not faked.
- **One tenant's data is never visible to another** — every query is scoped to the company that owns it.

![Placeholder: simple architecture diagram — Web app + Worker over a shared DB, with an on-chain commitment on one side and a fiat webhook on the other, meeting at a receipt](placeholder-image.png)

**Speaker notes:** You don't need to care about our stack — here's the shape. A web app for creating and viewing payments, a background worker that watches confirmations and matches the two legs, and a database as the source of truth. The clever bit is the join: every payment has one reference id that travels on both the on-chain side and the bank side, so when both arrive the worker can prove they're the same money. We never match on amount alone — that's how you avoid false positives. And the privacy is real and verifiable: the ledger only sees a commitment, the details are encrypted with the company's key, and the proof is checked by a real on-chain verifier.

---

## Slide 6: Impact / market

- **Who needs this:**
  - Companies running crypto-based payroll / vendor payouts who want privacy from competitors.
  - Finance & accounting teams who need a receipt, not a transaction hash.
  - Compliance / AML reviewers who need controlled decryption — without exposing payments publicly.
- **Why now:** stablecoin payroll and B2B payouts are growing fast, but the operational layer on top of them barely exists. Every team using these rails is hand-reconciling spreadsheets against explorer links.
- **The wedge:** start with the receipt — the thing every finance team already understands — and let the privacy be the reason they switch, not the thing they have to learn. [inferred: go-to-market framing]
- **The moat:** private *and* reconciled *and* accounting-ready in one product. Privacy tools do the first; accounting tools do the third; nobody does all three. [inferred: competitive framing]

![Placeholder: simple market map — Privacy tools (shield only) vs. Accounting tools (receipt only) vs. Trexure (all three)](placeholder-image.png)

**Speaker notes:** Who actually needs this? Any company paying people or vendors over these rails — they want privacy from competitors, but their finance team still needs a receipt and their compliance team still needs to decrypt on demand. The reason this matters now is that stablecoin payroll is growing fast, and the operational layer on top of it basically doesn't exist — teams are hand-reconciling spreadsheets against blockchain explorer links. Our wedge is the receipt itself: it's the thing finance already understands, and privacy becomes the reason to switch rather than the thing they have to learn. The moat is doing all three — private, reconciled, and accounting-ready — in one product, which nobody else does today.

---

## Slide 7: What's next

**Honest about where we are — and what's shipping next:**

- **A real shielded pool that moves real value on-chain — in build now (#59).** Today's on-chain leg records a cryptographic commitment and verifies a real proof, but no tokens actually move (only the network fee). We're building a **separate "Private on-chain transfer" rail**: a Soroban `ShieldedPool` contract that custodies **native XLM**, so you **deposit → withdraw to any address with the sender↔recipient link hidden in zero-knowledge** — Tornado-style secret notes, an on-chain Merkle tree, and nullifiers, reusing our already-live Groth16 / BLS12-381 verifier. **Phase 1 is already merged** — the cross-language MiMC hash spec (circom / Rust / TS golden vectors), the whole system's #1 risk; the circuit, contract, and testnet deposit→withdraw flow are next. *(Testnet, demo-grade, unaudited — hides the linkage, not the amount.)* [#59 / #60–#65]
- **A real fiat provider.** Today's payout is simulated by a built-in Mock Anchor that fires the *same* signed webhook a real provider would — so the reconciliation path is real, only the bank is faked. Swapping in a real anchor (SEP-31 / Xendit) is a config change, no app code to rewrite. [confirmed: `lib/anchor/mock.ts`]
- **Testnet → mainnet.** New payments are already on by default and record real `shielded_transfer` testnet txs; mainnet + a real anchor turn the demo into production volume. [confirmed: `ENABLE_NEW_PAYMENTS`]
- **Ecosystem-native** — plug into Stellar's SEPs, anchors, and (for the pool) Confidential Tokens as they mature; push the receipt straight into QuickBooks / Xero. [ties to the integration plan in #52]

![Placeholder: roadmap timeline — today (commitment + real reconciliation) → shielded pool moving real XLM privately (#59) → real anchor → mainnet → accounting integrations](placeholder-image.png)

**Speaker notes:** We're honest about where this is. Two rails. Today's rail — the one you just saw — records a real cryptographic commitment on-chain, verifies a real zero-knowledge proof, and reconciles against the fiat payout: that's all real; only the *bank* is a mock that fires the exact webhook a real anchor sends. What's NOT true today is that coins fly to a recipient wallet — the value moves on the fiat side. The second rail, which we're building right now under issue #59, changes that: a real shielded pool on Soroban where actual XLM moves — you deposit, someone withdraws to any address, and no one can link the two. It's Tornado-style, it reuses the same on-chain verifier we already run, and phase one — getting our hash to agree bit-for-bit across three languages, the riskiest part — is already merged. From there it's the circuit, the pool contract, and a live testnet deposit-to-withdraw. Then a real anchor, mainnet, and pushing the receipt straight into QuickBooks. We built the spine bulletproof first; these are the layers on top.

---

## Slide 8: Team / thanks

**Team**

- [Name — Role] *(placeholder)*
- [Name — Role] *(placeholder)*
- [Name — Role] *(placeholder)*

**Contact**
- [email / handle — placeholder]
- [repo / demo link — placeholder]

**Thanks to:** Stellar / Soroban testnet · the snarkjs + circom communities · [any other credits]

![Placeholder: team photo / avatars](placeholder-image.png)

**Speaker notes:** We're [team name]. [One line per person — who did what.] The repo and a live demo are at [link], and we'd love to talk to anyone running payroll or payouts over these rails. Thanks for your time — and thanks to the Stellar testnet and the open-source ZK tooling that made the real proof verification possible. We're happy to take questions.

---

# Recording script

> A continuous, readable narration for recording a ~3–5 minute pitch. Read this aloud, slide by slide. It expands each slide's speaker notes into a flowing script.

**[Slide 1 — Title]**
Hi, we're [team name], and we built Trexure — the private treasury that turns a hidden payment into a receipt your accountant already knows how to file. In the next few minutes I'll show you a payroll payment that's invisible to anyone watching the public ledger, that the company can still decrypt with its own key, that reconciles itself against a real bank payout, and that comes out as a clean receipt you could drop straight into your books. Everything runs against a real, live backend — not a slide animation.

**[Slide 2 — Problem]**
Picture a company running payroll over a public blockchain for contractors abroad. Every payment — the amount, the recipient, the timing — is sitting in plain text on a ledger anyone can read. Competitors, nosy contractors, the whole internet. The privacy tools that exist solve *hiding* the transaction, and then they stop. They don't tell finance "this on-chain transfer became this bank deposit," and they definitely don't generate something an accountant can file. So companies are stuck choosing between transparency they don't want, and privacy tooling with no operational layer on top — no reconciliation, no audit trail, no receipts. That gap is what we built Trexure to close.

**[Slide 3 — Solution]**
Trexure, in one sentence: a private payment walks in, a clean receipt walks out, and we prove it's the same money end to end. We shield the payment so the public ledger only sees a cryptographic commitment — not the payroll. We give the company its own key, so it can decrypt when it needs to, for audit or compliance, without that key ever leaving the server. When the real-world bank payout arrives, a background worker reconciles the two legs automatically. And the output is a receipt that looks like something Stripe or your bank already sends you — not a blockchain explorer. Private, reconciled, and accounting-ready, in one product.

**[Slide 4 — Demo]**
Here's the whole product in one payment — a $2,500 dollar-to-peso payroll payout, live. Beat one: this is all a competitor scraping the public ledger can see — a proof hash and a "Shielded" badge. No payroll. Beat two: the company applies its own view key, and the real payment appears — sender, recipient, amount. The key is used and immediately zeroized; it's never sent back to the browser and never logged. Beat three: we trigger the payout, a signed webhook comes back from the bank side, and watch the status flip from Pending to Settled as the worker stitches the on-chain hash to the bank reference. Beat four: the receipt — exact FX rate, fees, slippage, both transaction references, and a privacy block. Copy it as JSON, or export it as a PDF. The blockchain is now completely out of the picture.

**[Slide 5 — How it works]**
You don't need to care about our stack — here's the shape. A web app for creating and viewing payments, a background worker that watches confirmations and matches the two legs when they both arrive, and a database as the source of truth. The clever part is the join: every payment carries one shared reference id that travels on *both* the on-chain side and the bank side, so when both arrive the worker can prove "on-chain hash X produced bank deposit Y" with certainty. We never match on amount alone — that's how you avoid false positives. And the privacy is real and verifiable: the ledger sees only a commitment, the details are encrypted with the company's key, and the proof is checked by a real on-chain verifier. Every query is scoped to the company that owns the data — one tenant can never see another's payments.

**[Slide 6 — Impact / market]**
Who actually needs this? Any company paying people or vendors over these rails — they want privacy from competitors, but their finance team still needs a receipt and their compliance team still needs to decrypt on demand. It matters now because stablecoin payroll and B2B payouts are growing fast, and the operational layer on top barely exists — teams are hand-reconciling spreadsheets against blockchain explorer links. Our wedge is the receipt itself: it's the thing finance already understands, and privacy becomes the reason they switch, not the thing they have to learn. The moat is doing all three — private, reconciled, and accounting-ready — in one product, which nobody does today. Privacy tools do the first; accounting tools do the third; nobody does all three.

**[Slide 7 — What's next]**
We want to be honest about where this is — think of it as two rails. The rail you just saw records a real cryptographic commitment on-chain, verifies a real zero-knowledge proof, and reconciles against the fiat payout. That's all real; the only thing simulated is the *bank*, a mock that fires the exact same signed webhook a real anchor sends — so the reconciliation is real end to end, and swapping in a real provider is a config change. One honest clarification: today, coins don't fly to a recipient wallet — the money moves on the fiat side, and the chain holds the proof. The second rail, which we're building right now under issue fifty-nine, changes that: a real shielded pool on Soroban where actual XLM moves — you deposit, someone withdraws to any address, and no one can link the two. It's Tornado-style, it reuses the very same on-chain verifier we already run, and the riskiest part — making our hash agree bit-for-bit across three languages — is already merged. Next is the circuit, the pool contract, and a live testnet deposit-to-withdraw. From there: a real anchor, mainnet, and pushing the receipt straight into QuickBooks. We built the spine bulletproof first; these are the layers on top.

**[Slide 8 — Team / thanks]**
We're [team name]. [One line per person — who did what.] The repo and a live demo are at [link], and we'd love to talk to anyone running payroll or payouts over these rails. Thanks for your time — and thanks to the Stellar testnet and the open-source ZK tooling that made the real proof verification possible. We're happy to take questions.
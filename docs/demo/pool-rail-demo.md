# 🌊 Private on-chain transfer — demo script (≈90s)

> **Goal:** the second act of the Trexure pitch. After the reconciliation rail
> (`runbook.md`) shows *shielded payouts reconciled to fiat*, this shows the new
> **"Private on-chain transfer" rail**: **real XLM actually moves on Soroban
> testnet, and the sender↔recipient link is hidden in zero knowledge.** This is
> the milestone the older decks called "next" — it's now live (#59).

**The one-liner:** *"On the public Stellar ledger, a deposit and a withdrawal
happen — but nothing connects them. Value moved privately, on-chain, provably."*

**Deployed pool contract (Soroban testnet):**
`CB5FU3DBINAZXGT3KG3BIHXWA4SKN6VQUTJSBRBN4VHQBV2IIE7RLZT4`

---

## 0 · Pre-flight (before judges are watching)

Two ways to run it — pick one:

**In-app (for the product story):**
```bash
# turn the rail on (it's off by default) and start the app
ENABLE_POOL_RAIL=true pnpm dev
```
- [ ] Log in, confirm the sidebar now shows **Private Transfer** → `/pool`.
- [ ] Needs a funded `STELLAR_SOURCE_SECRET` (testnet) — the server signs + relays.

**CLI (for a zero-click, bulletproof fallback):**
```bash
pnpm pool:demo   # funds fresh accounts, deposits 10 XLM, withdraws to a new address
```
- [ ] Prints both tx hashes + stellar.expert links and asserts the invariants.

> **Safety net:** the CLI (`pnpm pool:demo`) is idempotent-ish (fresh accounts +
> a fresh note each run) and prints `✅ POOL DEMO PASSED`. If the UI misfires, run
> it in a terminal and read the links off-screen.

---

## 1 · Beat 1 — Deposit (mint a secret note) · *30s*

- [ ] On `/pool`, in **Shield into the pool**, enter **10 XLM** → **Shield into pool**.
- [ ] A real `deposit` tx lands; the UI reveals a **secret note** (`trexure-note-v1-…`) with a *"this is the only way to claim — save it"* warning.

🎤 *"We just deposited 10 real XLM into a shielded pool on Stellar testnet. In
return we hold a secret note — a bearer claim. Nothing on-chain says who will
receive this money, or when."*

**Why it matters:** the deposit is a genuine token transfer into a custody
contract that maintains an on-chain Merkle tree of commitments — not a
placeholder, not a memo.

---

## 2 · Beat 2 — Claim to a fresh address (the unlink) · *40s*

- [ ] Paste the note + a **brand-new** recipient address into **Claim a note** → **Claim to address**. *(Or just hit **Run demo** to do both sides automatically.)*
- [ ] The app builds a **Groth16 proof** (snarkjs, BLS12-381) that the note is in the tree and its nullifier is fresh, submits `withdraw`, and the pool pays the recipient. A `withdraw` tx link appears.

🎤 *"The claim proves — in zero knowledge — that we own **a** deposit in the pool,
without revealing **which** one. The pool pays a fresh address that has no
on-chain link to the depositor. Two transactions, zero connection."*

**Open both on stellar.expert and point at the envelopes:**
- **Deposit** [`ea37b3b5…`](https://stellar.expert/explorer/testnet/tx/ea37b3b5eab5676cd80842b90e59664b5f56bf1e2207a4cb3e4b6425d3d22024) — signed by depositor **A**.
- **Withdraw** [`c7d13eaf…`](https://stellar.expert/explorer/testnet/tx/c7d13eaf3b9a8d7db4ef373a62e2c44ebeb9e3eea488b29925b94ed293f54444) — pays recipient **B**; the envelope never references A or the deposit.

---

## 3 · Beat 3 — Double-spend is impossible · *15s*

- [ ] (CLI shows this automatically.) Replay the same note → **rejected**.

🎤 *"The note is spent — its nullifier is now on-chain, so it can never be
claimed twice. Privacy, but not double-spending."*

---

## ★ The moat line · *10s*

🎤 *"So Trexure has **two** private rails: shield-and-reconcile for fiat payouts,
and now a real **value-moving** private transfer on Stellar — deposit here,
withdraw there, unlinkable, with a live smart contract enforcing it. That's not
on a roadmap. That tx just happened."*

---

## What's real vs. demo-grade (be honest)

| Layer | Status |
|---|---|
| Real XLM moves (SAC transfer in → custody → transfer out) | **Real** on Soroban testnet |
| On-chain Merkle tree + nullifier set (`ShieldedPool` contract) | **Real** — deployed `CB5FU3DB…`, depth-4 tree |
| Groth16 withdraw proof (BLS12-381) verified **in-contract** | **Real** — pairing check on-chain; wrong root/nullifier → reject |
| Sender↔recipient unlinkability | **Real** — deposit and withdraw share no user account on-chain |
| Double-spend prevention (nullifier) | **Real** — replay is rejected |
| Trusted setup | **Demo-grade** — fixed entropy, single contributor; NOT a ceremony |
| Anonymity set | **Small (16 leaves, depth-4)** — sized to fit Soroban's per-tx budget; larger needs fewer MiMC rounds or a cheaper hash |
| Signing | **Server-signed** for the demo — real-wallet signing is out of scope |

> Do claim: real value moved privately on-chain, provably, with a live contract.
> Don't overclaim: it's testnet, demo-grade trusted setup, a 16-deposit anonymity
> set, and server-relayed. Judges respect the precision.

---

## Proof points to name-drop

- **Deployed contract:** `CB5FU3DBINAZXGT3KG3BIHXWA4SKN6VQUTJSBRBN4VHQBV2IIE7RLZT4` — deposit/withdraw/nullifier, custodies native XLM via its SAC.
- **The full ZK stack is real and cross-checked in three languages** (circom / Rust / TypeScript) via golden vectors — the MiMC hash the circuit proves, the contract commits to, and the app mirrors all agree bit-for-bit.
- **A genuine on-chain engineering finding:** 220-round MiMC over `Fr` costs ~19M CPU per tree level, so the tree is depth-4 to fit Soroban's 100M per-tx budget — measured, not guessed (see `docs/zk-mimc.md`).
- **One command proves it:** `pnpm pool:demo` → `✅ POOL DEMO PASSED — real XLM moved A→pool→B, unlinkable, double-spend blocked.`

---

_Companion to `docs/demo/runbook.md` (the reconciliation rail). Rail architecture:
`docs/payment-rails.md`. ZK internals: `docs/zk-mimc.md`. Contract + tx metadata:
`zk/pool-deploy.json`._

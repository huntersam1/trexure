# MiMC hash — shielded pool (P1, issue #60)

The single source of truth for the hash used across the shielded pool. The
**same** construction is implemented three times and must agree bit-for-bit:

| Where | File | Role |
| --- | --- | --- |
| TypeScript (reference) | `lib/pool/mimc.ts` | off-chain proving + tree mirror |
| circom (P2) | `zk/circuits/withdraw.circom` | in-circuit membership proof |
| Soroban Rust (P3) | `zk/verifier/**` | on-chain tree insert + root |

Golden vectors that all three must reproduce: **`zk/artifacts/mimc-golden.json`**
(regenerate with `node zk/scripts/gen-mimc-golden.mjs`). The TS test
`lib/pool/mimc.test.ts` locks the reference against that file.

## Parameters

- **Field:** BLS12-381 scalar field `Fr` (`FR` in `lib/zk/commit.ts`).
- **Construction:** circomlib **MiMCSponge** — Feistel permutation, S-box `x^5`
  — the algorithm Tornado Cash uses on BN254, ported to `Fr`.
- **Exponent:** `5`. Chosen because `gcd(5, r-1) = 1`, so `x^5` is a permutation
  over `Fr` (verified in test). `3` and `11` are **not** valid (share a factor
  with `r-1`); `7` also works but `5` matches circomlib.
- **Rounds:** `220` (circomlib convention; generous security margin).
- **Round constants:** `C[i] = SHA256("trexure-mimc-v1:" + i) mod r`, with
  `C[0] = C[219] = 0`. SHA256 (native `node:crypto`) is used instead of
  circomlib's keccak seed so no keccak dependency is needed — P2/P3 transcribe
  the exact 220 constants emitted in `roundConstantsHex`.

## Hash functions (domain-separated by absorb arity)

- `hash2(l, r)` — Merkle node (2 → 1).
- `commitmentHash(secret, nullifier, amount)` — deposit leaf (3 → 1).
- `nullifierHash(nullifier)` — public double-spend tag (1 → 1).

Different absorb counts make each function independent, so a leaf can't be
reinterpreted as an internal node or a nullifier.

## Withdraw circuit (P2, #61)

`zk/circuits/withdraw.circom` — the Tornado-style membership proof:
- `commitment = commitmentHash(secret, nullifier, amount)`, `nullifierHash === nullifierHash(nullifier)`, Merkle-fold `commitment` to `root` with `hash2`.
- Public signals (order fixed for the P3 verifier): **`[root, nullifierHash, recipient, amount]`**.
- `recipient` is a Stellar ed25519 key reduced mod `r` (`lib/pool/address.ts` `recipientToField`); bound with a dummy quadratic so a relayer can't swap the payee.
- **Depth 4** (16-leaf anonymity set) — bounded by the **on-chain** MiMC cost, not the trusted setup (~13.2k constraints fit a small **2^15** BLS12-381 powers-of-tau). Deposit/init do `depth` MiMC hashes at ~19M CPU each; depth 4 keeps them inside Soroban's 100M per-tx budget (see the measured table below). The depth **must** match `zk/verifier/src/pool.rs`.

`zk/circuits/mimcsponge.circom` ports P1's MiMCSponge. **One deliberate deviation from stock circomlib:** the final Feistel round keeps `xL` and folds `t^5` into `xR` (no output swap) to match `lib/pool/mimc.ts` — P1 is the source of truth. `zk/scripts/mimc-circuit-crosscheck.mjs` proves the in-circuit hashes reproduce the golden vectors.

Trusted setup is **demo-grade** (single contributor, fixed entropy) — not a ceremony. Rebuild everything with `zk/scripts/build-withdraw.sh`.

## On-chain contract (P3, #62)

`zk/verifier/src/pool.rs` — the `ShieldedPool` Soroban contract: incremental
Merkle tree + spent-nullifier set, `deposit` (SAC transfer in + insert leaf),
`withdraw` (reuse `groth16::verify` + nullifier + SAC transfer out). MiMC over
`Fr` is `zk/verifier/src/mimc.rs` (constants auto-generated into
`mimc_constants.rs` from the golden file). The Rust MiMC **reproduces the P1
golden vectors** (`cargo test mimc_reproduces_p1_golden_vectors`), and the
contract **verifies the real P2 proof in-contract** (deposit the demo
commitment → on-chain tree root equals the proof's public root → withdraw pays
out; double-spend + unknown-root rejected).

### On-chain cost finding (measured) → resolved with a shallow tree (P3.5, #74)

220-round MiMC over `Fr` is **expensive** on Soroban: one `hash2` ≈ **19M CPU**,
dominated by `Bls12381FrFromU256` — the per-operand host conversion every field
op pays. That cost is intrinsic to the field arithmetic; building the 220 round
constants once per tx (already done) only saves ~1M. So the cost of a tree op is
essentially `depth × 19M`, and the only levers are **fewer rounds** or **fewer
hashes** (shallower tree). `withdraw` (a single pairing check, no MiMC) is cheap
regardless.

Measured `initialize` / `deposit` CPU vs Soroban's **100M** default per-tx budget
(each is its own transaction on-network, so each gets a fresh 100M):

| Depth | `initialize` | `deposit` | Fits 100M? | Anonymity set |
|------:|-------------:|----------:|:-----------|:--------------|
| 4 | 77.2M | 77.5M | ✅ ~22% headroom | 16 |
| 5 | 96.2M | 96.5M | ⚠️ ~3.5% margin | 32 |
| 6 | 115.2M | 115.6M | ❌ exceeds | 64 |

**Resolution (#74): depth 4.** Keeps Approach A fully **trustless** (no
operator-posted roots) while fitting the budget with headroom. The SAC token
transfer in `deposit` adds only ~250K CPU, so hashing dominates. The
`initialize_and_deposit_fit_default_budget_at_depth_4` test asserts each call
succeeds under `budget().reset_default()`; the full deposit→withdraw flow test
uses `reset_unlimited()` because it chains several ops in one env.

Alternatives considered and rejected for the demo: **Approach C** (off-chain tree,
operator-posted roots — deployable but operator-trusted) and **fewer MiMC rounds**
(~110 floor — bigger set but reopens P1 golden vectors). Both remain viable future
directions if a larger anonymity set is needed; depth is a single-line change in
the circuit + contract once a larger set is worth the cost (fewer rounds or a
per-op-cheaper hash).

### Status (P3 is a feature-gated spike)

The pool is kept **out of the default verifier build** (`cargo build` →
Groth16Verifier only, wasm unchanged) so the deployed verifier doesn't drift;
build/test the pool explicitly:

```
cargo test --features pool
cargo build --release --target wasm32-unknown-unknown --features pool
```

It remains demo-grade (unaudited, demo trusted setup). Full production would also
split the pool into its own crate/build target (separate wasm from the verifier).

## Transcribing to circom / Rust (P2 / P3)

1. Use MiMCSponge with `nRounds = 220`, S-box `x^5`.
2. Load the 220 constants from `roundConstantsHex` (do **not** recompute with a
   different seed/hash — they must be byte-identical).
3. Verify against every vector in `mimc-golden.json` before wiring into the
   tree/circuit.

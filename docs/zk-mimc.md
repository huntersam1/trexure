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

## Transcribing to circom / Rust (P2 / P3)

1. Use MiMCSponge with `nRounds = 220`, S-box `x^5`.
2. Load the 220 constants from `roundConstantsHex` (do **not** recompute with a
   different seed/hash — they must be byte-identical).
3. Verify against every vector in `mimc-golden.json` before wiring into the
   tree/circuit.

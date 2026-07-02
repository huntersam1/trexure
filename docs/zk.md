# Zero-Knowledge Proofs — Trexure

Trexure uses a **real Groth16 zero-knowledge proof** verified **on-chain** by a
Soroban contract on the Stellar testnet. Nothing here is mocked: proofs are
generated with snarkjs and verified by BLS12-381 pairing checks inside a deployed
contract.

## The statement
> "I know `(secret, blinding)` that open the public commitment
> `C = secret² + blinding` (mod r)."

Only a holder of the tenant **view key** can reproduce `(secret, blinding)` — they
are derived as `Hash(tag ‖ viewKey ‖ intentId) mod r` (see `lib/zk/commit.ts`).
The secret never leaves the server and never goes on-chain; only the commitment
(`proofHash`) and the proof are public. This binds the privacy claim to the same
view key that decrypts the payload.

## Pipeline
1. **Circuit** — `zk/circuits/commit.circom`, compiled with circom over **BLS12-381**
   (`-p bls12381`) so the proof can be verified with Soroban's BLS host functions.
2. **Trusted setup** — Groth16 (`snarkjs`), producing the proving key
   (`zk/artifacts/commit_final.zkey`) and verifying key (`zk/artifacts/vk.json`).
3. **Prover** — `lib/zk/groth16.ts` (`proveCommitment`) runs snarkjs server-side.
4. **Verifier contract** — `zk/verifier/` is a Soroban contract that runs the
   Groth16 multi-pairing check via `env.crypto().bls12_381()`. Deployed to testnet;
   the id + wasm hash + encoding are recorded in `zk/deploy.json`.
5. **On-chain verify** — `lib/zk/groth16.ts` (`verifyProofOnChain`) encodes the
   proof and simulates `verify` against the contract (read-only, never mocked).

## snarkjs → Soroban encoding (the fiddly part)
Locked by brute-forcing a known-good proof on-chain (`zk/scripts/onchain-verify.mjs`):
- Field elements: **big-endian**, 48 bytes (Fp) / 32 bytes (Fr).
- G1 = `x ‖ y` (96 bytes); G2 Fp2 components are **c1-first** (`x.c1 ‖ x.c0 ‖ y.c1 ‖ y.c0`, 192 bytes).
- Proof `A` is **negated off-chain** so the contract does a single
  `pairing_check([-A, α, vk_x, C], [B, β, γ, δ]) == 1`.

## Where it runs in the app
- **Seed** sets the sample payment's `proofHash` to the real commitment.
- **`POST /api/payments/[id]/verify-proof`** regenerates the proof from the view key
  and verifies it on-chain — surfaced by the **"Verify proof on-chain"** button on
  the payment page.
- **`shield`** (new payments) generates a real proof when `ZK_PROVING=live`
  (`lib/zk/index.ts`); otherwise it uses a clearly-labeled AES-wrap fallback and
  **never fakes verification**.

## Reproduce / demo
```bash
# Toolchain: circom, snarkjs, stellar CLI, rustup wasm32v1-none target.
pnpm zk:demo        # generate a fresh proof, verify on testnet, show tampered → false
```
Env: `ZK_CONTRACT_ID` (from `zk/deploy.json`), a funded `STELLAR_SOURCE_SECRET`,
`ZK_PROVING=live` to enable real proving in `shield`.

## The `shielded_transfer` entrypoint (new-payment path)

The same deployed contract also exposes `shielded_transfer(intent_id, amount,
source_asset, commitment)` — a **commitment recorder** used by new-payment
submission (`buildAndSubmitPrivatePayment`). It publishes a contract event with
`topics = (intent_id,)` and `data = commitment` (the payment's `proofHash`);
the watch-onchain worker confirms the payment from that event. It does NOT move
tokens and keeps no note/nullifier state — it anchors the payment intent
on-chain honestly without claiming to be a privacy pool.

## Rebuild the verifier (optional)
```bash
cd zk/verifier && stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/groth16_verifier.wasm \
  --source <funded-key> --network testnet
# update zk/deploy.json + ZK_CONTRACT_ID
```

## Honesty
The circuit is intentionally minimal (knowledge-of-opening of a commitment) — the
*cryptographic machinery* is what's real: a genuine Groth16 proof, a genuine
on-chain BLS12-381 pairing verification, and a tampered statement is rejected
(`false`). A richer privacy-pool circuit can be swapped in behind the same
prove/verify interface.

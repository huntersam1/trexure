# Vendored: Forked Nethermind Stellar Private Payments (SPP)

Trexure does **NOT** author ZK circuits. This directory vendors the forked
Nethermind SPP stack as a git submodule and treats it as a dependency:

- **Privacy-pool Soroban contracts** — incl. the Groth16 **verifier** deployed to
  testnet; its contract id is configured via `ZK_CONTRACT_ID` (SPEC §11).
- **Circom circuits** (`*.circom`) + compiled artifacts — used **as-is** from the fork.
- **Client-side WASM prover** — published from the fork as the `@trexure/spp` package
  (workspace/file dependency). `lib/zk/spp-client.ts` lazy-loads it.

## What Trexure does with SPP
1. **Shield:** submit a private payment + obtain a proof; store `encryptedPayload`,
   `payloadNonce`, `proofHash` on the `Payment` row.
2. **Decrypt:** unwrap `encryptedPayload` server-side with the tenant view key.
3. **Verify:** call the on-chain Groth16 verifier (`ZK_CONTRACT_ID`) — never mocked.

## Setup
```bash
git submodule add <fork-url> vendor/spp/upstream
git submodule update --init --recursive
# build the WASM prover from the fork and expose it as the `@trexure/spp` workspace package
```

## Real vs fallback (SPEC §14.5)
When the WASM prover is wired (`ZK_SPP_PROVING=live` + module present + `ZK_CONTRACT_ID`
set), `shield` runs the **real** SPP proving path. Otherwise it uses the
**clearly-labeled AES-wrap fallback** in `lib/zk/index.ts`. In BOTH cases
`verifyProofOnChain` makes a **real** on-chain call — the fallback never fakes
verification.

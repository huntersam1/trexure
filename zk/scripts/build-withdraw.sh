#!/usr/bin/env bash
# Reproducible build for the shielded-pool withdraw circuit (P2, #61).
# Requires: circom 2.x (release binary ok), snarkjs (node_modules/.bin), node/tsx.
# Produces committed artifacts in zk/artifacts/. Powers-of-tau + zkey intermediates
# live in zk/build/ (gitignored). Trusted setup here is DEMO-GRADE (single
# contributor, fixed entropy) — NOT a ceremony; do not use for real value.
set -euo pipefail
cd "$(dirname "$0")/.."                 # -> zk/
ROOT="$(cd .. && pwd)"
CIRCOM="${CIRCOM:-$ROOT/.localbin/circom}"
SNARKJS="$ROOT/node_modules/.bin/snarkjs"
POW=16                                   # 2^16 domain: fits depth-12 (2*constraints < 2^16)

mkdir -p build artifacts
echo "== 1. regenerate circom constants from P1 golden =="
node "$ROOT/node_modules/.bin/tsx" scripts/gen-mimc-circom-constants.mjs 2>/dev/null || \
  "$ROOT/node_modules/.bin/tsx" scripts/gen-mimc-circom-constants.mjs

echo "== 2. compile withdraw.circom (bls12381) =="
"$CIRCOM" circuits/withdraw.circom --r1cs --wasm --prime bls12381 -o build -l circuits

echo "== 3. powers of tau (bls12381, 2^$POW) =="
if [ ! -f build/pot${POW}_final.ptau ]; then
  "$SNARKJS" powersoftau new bls12381 $POW build/pot${POW}_0000.ptau
  "$SNARKJS" powersoftau contribute build/pot${POW}_0000.ptau build/pot${POW}_0001.ptau --name="trexure-demo-p2" -e="trexure-p2-pot-fixed-61"
  "$SNARKJS" powersoftau prepare phase2 build/pot${POW}_0001.ptau build/pot${POW}_final.ptau
fi

echo "== 4. groth16 setup + contribute + export vk =="
"$SNARKJS" groth16 setup build/withdraw.r1cs build/pot${POW}_final.ptau build/withdraw_0000.zkey
"$SNARKJS" zkey contribute build/withdraw_0000.zkey build/withdraw_final.zkey --name="trexure-demo-p2" -e="trexure-p2-zkey-fixed-61"
"$SNARKJS" zkey export verificationkey build/withdraw_final.zkey artifacts/withdraw_vk.json

echo "== 5. publish committed artifacts to zk/artifacts/ =="
cp build/withdraw.r1cs artifacts/withdraw.r1cs
cp build/withdraw_js/withdraw.wasm artifacts/withdraw.wasm
cp build/withdraw_final.zkey artifacts/withdraw_final.zkey

echo "== 6. prove + verify (positive/negative) and write proof fixtures =="
"$ROOT/node_modules/.bin/tsx" scripts/withdraw-prove.mjs

echo "DONE. Committed artifacts in zk/artifacts/."

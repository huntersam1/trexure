pragma circom 2.1.0;

// Minimal, honest ZK statement for Trexure's shielded payments:
//   "I know (secret, blinding) that open the PUBLIC commitment C,
//    where C = secret^2 + blinding (over the BLS12-381 scalar field)."
//
// The public ledger only sees C (a binding algebraic commitment); the Groth16
// proof attests the shielder knows the opening WITHOUT revealing secret/blinding.
// Compiled with `-p bls12381` so the on-chain verifier can use Soroban's
// BLS12-381 pairing host functions. No Poseidon/curve-specific gadgets, so it is
// safe over the BLS12-381 scalar field.
template Commit() {
    signal input secret;      // private
    signal input blinding;    // private
    signal input commitment;  // public

    signal s2;
    s2 <== secret * secret;            // quadratic constraint
    commitment === s2 + blinding;       // binding to the public commitment
}

component main { public [commitment] } = Commit();

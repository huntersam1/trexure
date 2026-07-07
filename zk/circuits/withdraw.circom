pragma circom 2.1.0;

include "mimcsponge.circom";

// Trexure shielded-pool withdraw circuit (P2, #61). Proves — in zero knowledge —
// ownership of a deposit note in the on-chain Merkle tree and a fresh nullifier,
// WITHOUT revealing which deposit. Tornado-style, over BLS12-381 with MiMC (P1).
//
// Public signals (order fixed for the on-chain verifier, P3):
//   [ root, nullifierHash, recipient, amount ]
// recipient is the payout Stellar ed25519 public key, big-endian, reduced mod r
// (32 bytes ~ 256 bits > field; reduction is binding — see docs/zk-mimc.md / P3).

template CommitmentHasher() {
    signal input secret;
    signal input nullifier;
    signal input amount;
    signal output commitment;
    signal output nullifierHash;

    component cm = MiMCSponge(3, 220, 1);
    cm.ins[0] <== secret;
    cm.ins[1] <== nullifier;
    cm.ins[2] <== amount;
    cm.k <== 0;
    commitment <== cm.outs[0];

    component nh = MiMCSponge(1, 220, 1);
    nh.ins[0] <== nullifier;
    nh.k <== 0;
    nullifierHash <== nh.outs[0];
}

// Selects (left, right) = pathIndices==0 ? (cur, sibling) : (sibling, cur).
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0; // s is a bit
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== i == 0 ? leaf : hashers[i - 1].outs[0];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = MiMCSponge(2, 220, 1);
        hashers[i].ins[0] <== selectors[i].out[0];
        hashers[i].ins[1] <== selectors[i].out[1];
        hashers[i].k <== 0;
    }

    root === hashers[levels - 1].outs[0];
}

template Withdraw(levels) {
    signal input root;          // public
    signal input nullifierHash; // public
    signal input recipient;     // public
    signal input amount;        // public
    signal input secret;        // private
    signal input nullifier;     // private
    signal input pathElements[levels]; // private
    signal input pathIndices[levels];  // private

    component hasher = CommitmentHasher();
    hasher.secret <== secret;
    hasher.nullifier <== nullifier;
    hasher.amount <== amount;
    hasher.nullifierHash === nullifierHash;

    component tree = MerkleTreeChecker(levels);
    tree.leaf <== hasher.commitment;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // amount is bound via the commitment. Bind recipient with a dummy quadratic
    // constraint (Tornado-style) so an untrusted relayer can't swap the payee.
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

// Depth 4 → 16-leaf anonymity set. Depth is bounded by the on-chain cost, NOT
// the trusted setup: each tree level costs ~19M CPU on Soroban (220-round MiMC
// over Fr), and `deposit`/`initialize` do `depth` hashes — depth 4 = ~77M, which
// fits Soroban's 100M per-tx budget with headroom (depth 5 ≈ 96M is too tight,
// depth 6 ≈ 115M exceeds it). This depth MUST match the pool contract's tree
// (zk/verifier/src/pool.rs) or the proof won't verify against the on-chain root.
// See docs/zk-mimc.md for the measured depth→CPU table.
component main {public [root, nullifierHash, recipient, amount]} = Withdraw(4);

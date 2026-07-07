pragma circom 2.1.0;

include "mimcsponge.circom";

// Test-only harness: exposes the three MiMC hashes as outputs so a witness can
// be cross-checked against the P1 golden vectors (zk/artifacts/mimc-golden.json).
// Proves the in-circuit MiMC == lib/pool/mimc.ts bit-for-bit.
template MimcCheck() {
    signal input a;
    signal input b;
    signal input secret;
    signal input nullifier;
    signal input amount;

    signal output hash2out;
    signal output commitment;
    signal output nullifierHashOut;

    component h = MiMCSponge(2, 220, 1);
    h.ins[0] <== a;
    h.ins[1] <== b;
    h.k <== 0;
    hash2out <== h.outs[0];

    component c = MiMCSponge(3, 220, 1);
    c.ins[0] <== secret;
    c.ins[1] <== nullifier;
    c.ins[2] <== amount;
    c.k <== 0;
    commitment <== c.outs[0];

    component n = MiMCSponge(1, 220, 1);
    n.ins[0] <== nullifier;
    n.k <== 0;
    nullifierHashOut <== n.outs[0];
}

component main = MimcCheck();

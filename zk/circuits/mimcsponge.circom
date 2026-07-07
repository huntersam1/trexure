pragma circom 2.1.0;

include "mimc_constants.circom";

// MiMCSponge over BLS12-381 Fr — faithful port of circomlib's MiMCSponge with
// Trexure's own round constants (mimc_constants.circom, from P1 #60). S-box is
// x^5 (exponent 5, a permutation over Fr since gcd(5, r-1)=1); 220 rounds.
// MUST reproduce lib/pool/mimc.ts + zk/artifacts/mimc-golden.json bit-for-bit.

template MiMCFeistel(nrounds) {
    signal input xL_in;
    signal input xR_in;
    signal input k;
    signal output xL_out;
    signal output xR_out;

    var c[220] = mimcConstants();

    signal t[nrounds];
    signal t2[nrounds];
    signal t4[nrounds];
    signal t5[nrounds];
    signal xL[nrounds - 1];
    signal xR[nrounds - 1];

    for (var i = 0; i < nrounds; i++) {
        t[i] <== (i == 0) ? k + xL_in : k + xL[i - 1] + c[i];
        t2[i] <== t[i] * t[i];
        t4[i] <== t2[i] * t2[i];
        t5[i] <== t4[i] * t[i];
        if (i < nrounds - 1) {
            xL[i] <== (i == 0) ? xR_in + t5[i] : xR[i - 1] + t5[i];
            xR[i] <== (i == 0) ? xL_in : xL[i - 1];
        } else {
            // Last round matches lib/pool/mimc.ts (P1, the source of truth):
            // keep xL, fold t^5 into xR (no output swap). This differs from
            // stock circomlib; P1's golden vectors are the reference all three
            // implementations (TS/circom/Rust) must reproduce.
            xL_out <== (i == 0) ? xL_in : xL[i - 1];
            xR_out <== (i == 0) ? xR_in + t5[i] : xR[i - 1] + t5[i];
        }
    }
}

template MiMCSponge(nInputs, nRounds, nOutputs) {
    signal input ins[nInputs];
    signal input k;
    signal output outs[nOutputs];

    component S[nInputs + nOutputs - 1];

    for (var i = 0; i < nInputs + nOutputs - 1; i++) {
        S[i] = MiMCFeistel(nRounds);
        S[i].xL_in <== (i == 0) ? ins[0] : S[i - 1].xL_out + (i < nInputs ? ins[i] : 0);
        S[i].xR_in <== (i == 0) ? 0 : S[i - 1].xR_out;
        S[i].k <== k;
    }

    outs[0] <== S[nInputs + nOutputs - 2].xL_out;
    for (var i = 0; i < nOutputs - 1; i++) {
        outs[i + 1] <== S[nInputs + i].xL_out;
    }
}

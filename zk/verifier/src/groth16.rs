//! Shared Groth16 verification over BLS12-381 (extracted so both the standalone
//! Groth16Verifier contract and the ShieldedPool contract reuse it — no
//! duplication). Same multi-pairing check as before:
//!   e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
//! where vk_x = IC[0] + sum_i pub_i * IC[i+1]. `neg_a` is pre-negated by the caller.

use soroban_sdk::crypto::bls12_381::{Fr, G1Affine, G2Affine};
use soroban_sdk::{BytesN, Env, Vec};

#[allow(clippy::too_many_arguments)]
pub fn verify(
    env: &Env,
    vk_alpha: &BytesN<96>,
    vk_beta: &BytesN<192>,
    vk_gamma: &BytesN<192>,
    vk_delta: &BytesN<192>,
    vk_ic: &Vec<BytesN<96>>,
    neg_a: &BytesN<96>,
    b: &BytesN<192>,
    c: &BytesN<96>,
    pub_signals: &Vec<BytesN<32>>,
) -> bool {
    let bls = env.crypto().bls12_381();
    let n = pub_signals.len();

    // vk_x = IC[0] + sum_i pub_i * IC[i+1]
    let mut ic_points: Vec<G1Affine> = Vec::new(env);
    let mut scalars: Vec<Fr> = Vec::new(env);
    for i in 0..n {
        ic_points.push_back(G1Affine::from_bytes(vk_ic.get(i + 1).unwrap()));
        scalars.push_back(Fr::from_bytes(pub_signals.get(i).unwrap()));
    }
    let acc = bls.g1_msm(ic_points, scalars);
    let ic0 = G1Affine::from_bytes(vk_ic.get(0).unwrap());
    let vk_x = bls.g1_add(&ic0, &acc);

    // Multi-pairing check.
    let mut vp1: Vec<G1Affine> = Vec::new(env);
    let mut vp2: Vec<G2Affine> = Vec::new(env);
    vp1.push_back(G1Affine::from_bytes(neg_a.clone()));
    vp2.push_back(G2Affine::from_bytes(b.clone()));
    vp1.push_back(G1Affine::from_bytes(vk_alpha.clone()));
    vp2.push_back(G2Affine::from_bytes(vk_beta.clone()));
    vp1.push_back(vk_x);
    vp2.push_back(G2Affine::from_bytes(vk_gamma.clone()));
    vp1.push_back(G1Affine::from_bytes(c.clone()));
    vp2.push_back(G2Affine::from_bytes(vk_delta.clone()));

    bls.pairing_check(vp1, vp2)
}

#![no_std]
use soroban_sdk::crypto::bls12_381::{Fr, G1Affine, G2Affine};
use soroban_sdk::{contract, contractimpl, BytesN, Env, String, Vec};

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Record a shielded-transfer intent as a contract event.
    ///
    /// This is a COMMITMENT RECORDER, not a privacy pool: no tokens move and
    /// no note/nullifier state is kept (that remains future work). It anchors
    /// the payment's commitment on-chain so the off-chain watcher can confirm
    /// the intent by contract event.
    ///
    /// Event shape (what `watch-onchain` filters on):
    ///   topics = (intent_id,)   — the reconciliation join key
    ///   data   = commitment     — the payment's proofHash / ZK commitment
    pub fn shielded_transfer(
        env: Env,
        intent_id: String,
        amount: String,
        source_asset: String,
        commitment: String,
    ) {
        // amount/source_asset stay out of the event payload; they are already
        // visible as call arguments in the tx envelope and add nothing to the
        // join. The event carries only join key + commitment.
        let _ = (&amount, &source_asset);
        env.events().publish((intent_id,), commitment);
    }

    /// Generic Groth16 verification over BLS12-381 using Soroban host pairings.
    ///
    /// `neg_a` is the NEGATION of proof.A (the caller pre-negates so the contract
    /// performs a single multi-pairing check). Public-input scalars are 32-byte
    /// big-endian, each < r. Returns true iff the proof verifies.
    ///
    /// Check: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1,
    /// where vk_x = IC[0] + sum_i pub_i * IC[i+1].
    #[allow(clippy::too_many_arguments)]
    pub fn verify(
        env: Env,
        vk_alpha: BytesN<96>,
        vk_beta: BytesN<192>,
        vk_gamma: BytesN<192>,
        vk_delta: BytesN<192>,
        vk_ic: Vec<BytesN<96>>,
        neg_a: BytesN<96>,
        b: BytesN<192>,
        c: BytesN<96>,
        pub_signals: Vec<BytesN<32>>,
    ) -> bool {
        let bls = env.crypto().bls12_381();
        let n = pub_signals.len();

        // vk_x = IC[0] + sum_i pub_i * IC[i+1]
        let mut ic_points: Vec<G1Affine> = Vec::new(&env);
        let mut scalars: Vec<Fr> = Vec::new(&env);
        for i in 0..n {
            ic_points.push_back(G1Affine::from_bytes(vk_ic.get(i + 1).unwrap()));
            scalars.push_back(Fr::from_bytes(pub_signals.get(i).unwrap()));
        }
        let acc = bls.g1_msm(ic_points, scalars);
        let ic0 = G1Affine::from_bytes(vk_ic.get(0).unwrap());
        let vk_x = bls.g1_add(&ic0, &acc);

        // Multi-pairing check.
        let mut vp1: Vec<G1Affine> = Vec::new(&env);
        let mut vp2: Vec<G2Affine> = Vec::new(&env);
        vp1.push_back(G1Affine::from_bytes(neg_a));
        vp2.push_back(G2Affine::from_bytes(b));
        vp1.push_back(G1Affine::from_bytes(vk_alpha));
        vp2.push_back(G2Affine::from_bytes(vk_beta));
        vp1.push_back(vk_x);
        vp2.push_back(G2Affine::from_bytes(vk_gamma));
        vp1.push_back(G1Affine::from_bytes(c));
        vp2.push_back(G2Affine::from_bytes(vk_delta));

        bls.pairing_check(vp1, vp2)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{vec, Env, IntoVal, String};

    #[test]
    fn shielded_transfer_emits_intent_topic_and_commitment_data() {
        let env = Env::default();
        let contract_id = env.register(Groth16Verifier, ());
        let client = Groth16VerifierClient::new(&env, &contract_id);

        let intent = String::from_str(&env, "intent_abc123");
        let commitment = String::from_str(&env, "0xdeadbeef");
        client.shielded_transfer(
            &intent,
            &String::from_str(&env, "1200.00"),
            &String::from_str(&env, "USDC"),
            &commitment,
        );

        assert_eq!(
            env.events().all(),
            vec![
                &env,
                (
                    contract_id,
                    (intent,).into_val(&env),
                    commitment.into_val(&env)
                ),
            ]
        );
    }
}

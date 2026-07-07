//! ShieldedPool — a Tornado-style privacy pool on Soroban (P3, #62).
//!
//! Custodies a token (native XLM via its SAC) and keeps an on-chain incremental
//! Merkle tree of deposit commitments + a spent-nullifier set. Deposits insert a
//! leaf; withdrawals prove membership + a fresh nullifier in zero knowledge
//! (the P2 circuit / vk), and the contract pays out — unlinkable to the deposit.
//!
//! DEMO-GRADE, not audited, not for real value. Two documented trust assumptions
//! (see deposit/withdraw): the deposited amount is assumed to match the amount
//! bound in the commitment (a production pool needs fixed denominations or
//! value-commitment range proofs), and `recipient_field` is assumed to be the
//! honest encoding of `recipient` (a production contract derives it on-chain).

use soroban_sdk::crypto::bls12_381::Fr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, BytesN, Env, Vec,
};

use crate::mimc;

const ROOT_HISTORY: u32 = 30;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    TreeFull = 3,
    UnknownRoot = 4,
    NullifierUsed = 5,
    InvalidProof = 6,
    InvalidAmount = 7,
}

/// Groth16 verifying key for the withdraw circuit (P2), stored at init.
#[contracttype]
#[derive(Clone)]
pub struct Vk {
    pub alpha: BytesN<96>,
    pub beta: BytesN<192>,
    pub gamma: BytesN<192>,
    pub delta: BytesN<192>,
    pub ic: Vec<BytesN<96>>,
}

#[contracttype]
pub enum DataKey {
    Token,
    Depth,
    Vk,
    NextIndex,
    RootIdx,
    Root(u32),           // ring buffer of recent roots
    FilledSubtree(u32),  // last-filled left node per level
    Zero(u32),           // precomputed all-zero subtree hash per level
    Nullifier(BytesN<32>),
}

fn fr_zero(env: &Env) -> Fr {
    mimc::fr_from_be(env, &[0u8; 32])
}

/// Encode a non-negative i128 as a 32-byte big-endian field element — matches the
/// circuit's `amount` public signal (snarkjs encodes the integer as an Fr).
fn amount_to_fr_bytes(env: &Env, amount: i128) -> BytesN<32> {
    let mut out = [0u8; 32];
    out[16..32].copy_from_slice(&amount.to_be_bytes());
    BytesN::from_array(env, &out)
}

#[contract]
pub struct ShieldedPool;

#[contractimpl]
impl ShieldedPool {
    /// One-time init: token (SAC) to custody, tree depth, and the withdraw vk.
    pub fn initialize(env: Env, token: Address, depth: u32, vk: Vk) {
        let s = env.storage().instance();
        if s.has(&DataKey::Token) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Depth, &depth);
        s.set(&DataKey::Vk, &vk);
        s.set(&DataKey::NextIndex, &0u32);
        s.set(&DataKey::RootIdx, &0u32);

        // Precompute the all-zero subtree hash per level once, so each deposit
        // does only `depth` MiMC hashes (not 2*depth). zeros[0]=0, zeros[i+1]=H(zeros[i],zeros[i]).
        let bls = env.crypto().bls12_381();
        let c = mimc::constants(&env);
        let mut z = fr_zero(&env);
        for i in 0..depth {
            s.set(&DataKey::Zero(i), &z.to_bytes());
            z = mimc::hash2_c(&env, &bls, &c, z.clone(), z);
        }
    }

    /// Deposit `amount` of the pool token and insert `commitment` into the tree.
    ///
    /// NOTE (demo trust assumption): the contract cannot check that `amount`
    /// equals the amount bound inside `commitment` (the commitment hides it).
    /// Deposits are server-orchestrated in the demo; a production pool needs
    /// fixed denominations or value commitments to prevent amount inflation.
    pub fn deposit(env: Env, from: Address, amount: i128, commitment: BytesN<32>) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let token: Address = Self::cfg(&env, DataKey::Token);
        token::TokenClient::new(&env, &token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        let leaf = Fr::from_bytes(commitment.clone());
        let (root, index) = Self::insert(&env, leaf);
        env.events()
            .publish((symbol_short!("deposit"),), (commitment, index, root));
    }

    /// Withdraw `amount` to `recipient` against a valid ZK proof of an unspent
    /// note in the tree. Public signals: [root, nullifier_hash, recipient_field,
    /// amount]. `neg_a` is the pre-negated proof.A (soroban encoding).
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw(
        env: Env,
        neg_a: BytesN<96>,
        b: BytesN<192>,
        c: BytesN<96>,
        root: BytesN<32>,
        nullifier_hash: BytesN<32>,
        recipient: Address,
        recipient_field: BytesN<32>,
        amount: i128,
    ) {
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if !Self::is_known_root(&env, &root) {
            panic_with_error!(&env, Error::UnknownRoot);
        }
        let nk = DataKey::Nullifier(nullifier_hash.clone());
        if env.storage().persistent().has(&nk) {
            panic_with_error!(&env, Error::NullifierUsed);
        }

        // Public signals in the circuit's fixed order.
        let mut pub_signals: Vec<BytesN<32>> = Vec::new(&env);
        pub_signals.push_back(root);
        pub_signals.push_back(nullifier_hash.clone());
        pub_signals.push_back(recipient_field);
        pub_signals.push_back(amount_to_fr_bytes(&env, amount));

        let vk: Vk = Self::cfg(&env, DataKey::Vk);
        let ok = crate::groth16::verify(
            &env, &vk.alpha, &vk.beta, &vk.gamma, &vk.delta, &vk.ic, &neg_a, &b, &c, &pub_signals,
        );
        if !ok {
            panic_with_error!(&env, Error::InvalidProof);
        }

        env.storage().persistent().set(&nk, &true);
        let token: Address = Self::cfg(&env, DataKey::Token);
        token::TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );
        env.events()
            .publish((symbol_short!("withdraw"),), (nullifier_hash, recipient));
    }

    /// Current tree root (0 before any deposit).
    pub fn get_root(env: Env) -> BytesN<32> {
        let idx: u32 = env.storage().instance().get(&DataKey::RootIdx).unwrap_or(0);
        env.storage()
            .instance()
            .get(&DataKey::Root(idx))
            .unwrap_or_else(|| fr_zero(&env).to_bytes())
    }

    pub fn is_spent(env: Env, nullifier_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier_hash))
    }

    // ---- internals ----

    fn cfg<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val> + soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
        env: &Env,
        key: DataKey,
    ) -> T {
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
        let s = env.storage().instance();
        for i in 0..ROOT_HISTORY {
            if let Some(r) = s.get::<DataKey, BytesN<32>>(&DataKey::Root(i)) {
                if &r == root {
                    return true;
                }
            }
        }
        false
    }

    /// Incremental Merkle insert; returns (new_root, leaf_index).
    fn insert(env: &Env, leaf: Fr) -> (BytesN<32>, u32) {
        let bls = env.crypto().bls12_381();
        let s = env.storage().instance();
        let depth: u32 = Self::cfg(env, DataKey::Depth);
        let index: u32 = s.get(&DataKey::NextIndex).unwrap_or(0);
        if depth < 32 && index >= (1u32 << depth) {
            panic_with_error!(env, Error::TreeFull);
        }

        let c = mimc::constants(env); // build the 220 constants ONCE per deposit
        let mut idx = index;
        let mut cur = leaf;
        for i in 0..depth {
            let (left, right) = if idx & 1 == 0 {
                s.set(&DataKey::FilledSubtree(i), &cur.to_bytes());
                let z: BytesN<32> = s.get(&DataKey::Zero(i)).unwrap();
                (cur.clone(), Fr::from_bytes(z))
            } else {
                let fs: BytesN<32> = s.get(&DataKey::FilledSubtree(i)).unwrap();
                (Fr::from_bytes(fs), cur.clone())
            };
            cur = mimc::hash2_c(env, &bls, &c, left, right);
            idx >>= 1;
        }

        let new_root = cur.to_bytes();
        let ri: u32 = s.get(&DataKey::RootIdx).unwrap_or(0);
        let nri = (ri + 1) % ROOT_HISTORY;
        s.set(&DataKey::Root(nri), &new_root);
        s.set(&DataKey::RootIdx, &nri);
        s.set(&DataKey::NextIndex, &(index + 1));
        (new_root, index)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::withdraw_fixture as fx;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token;

    fn vk(env: &Env) -> Vk {
        let mut ic = Vec::new(env);
        for p in fx::VK_IC.iter() {
            ic.push_back(BytesN::from_array(env, p));
        }
        Vk {
            alpha: BytesN::from_array(env, &fx::VK_ALPHA),
            beta: BytesN::from_array(env, &fx::VK_BETA),
            gamma: BytesN::from_array(env, &fx::VK_GAMMA),
            delta: BytesN::from_array(env, &fx::VK_DELTA),
            ic,
        }
    }

    #[test]
    fn deposit_root_matches_proof_and_withdraw_pays_out_then_blocks_double_spend() {
        let env = Env::default();
        env.mock_all_auths();
        // NOTE: 220-round MiMC over Fr is expensive on-chain — deposit/init
        // (tree hashing) EXCEED Soroban's default per-tx budget (measured:
        // reset_default() fails at initialize). These tests validate logic, not
        // gas. See docs/zk-mimc.md for the on-chain-cost finding + fallbacks
        // (Approach C off-chain tree, fewer MiMC rounds, or a shallower tree).
        // Withdraw itself (pairing verify only, no MiMC) fits the budget.
        env.cost_estimate().budget().reset_unlimited();

        // Native-like SAC token.
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token_addr = sac.address();
        let asset = token::StellarAssetClient::new(&env, &token_addr);
        let token = token::TokenClient::new(&env, &token_addr);

        let amount: i128 = fx::AMOUNT;
        let depositor = Address::generate(&env);
        asset.mint(&depositor, &amount);

        // Deploy + init the pool (depth 12 = the P2 circuit).
        let pool_id = env.register(ShieldedPool, ());
        let pool = ShieldedPoolClient::new(&env, &pool_id);
        pool.initialize(&token_addr, &12u32, &vk(&env));

        // Deposit the demo note's commitment. The on-chain tree must reproduce the
        // exact root the P2 proof was generated against (P2<->P3 MiMC/tree agreement).
        let commitment = BytesN::from_array(&env, &fx::COMMITMENT);
        pool.deposit(&depositor, &amount, &commitment);
        assert_eq!(
            pool.get_root(),
            BytesN::from_array(&env, &fx::PUB_ROOT),
            "on-chain tree root == proof public root"
        );
        assert_eq!(token.balance(&pool_id), amount);

        // Withdraw with the REAL P2 proof -> pays out, unlinkable to the deposit.
        let recipient = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &fx::PUB_NULLIFIER);
        pool.withdraw(
            &BytesN::from_array(&env, &fx::PROOF_NEG_A),
            &BytesN::from_array(&env, &fx::PROOF_B),
            &BytesN::from_array(&env, &fx::PROOF_C),
            &BytesN::from_array(&env, &fx::PUB_ROOT),
            &nullifier,
            &recipient,
            &BytesN::from_array(&env, &fx::PUB_RECIPIENT),
            &amount,
        );
        assert_eq!(token.balance(&recipient), amount, "recipient paid");
        assert_eq!(token.balance(&pool_id), 0);
        assert!(pool.is_spent(&nullifier));

        // Double-spend with the same nullifier must fail.
        let again = pool.try_withdraw(
            &BytesN::from_array(&env, &fx::PROOF_NEG_A),
            &BytesN::from_array(&env, &fx::PROOF_B),
            &BytesN::from_array(&env, &fx::PROOF_C),
            &BytesN::from_array(&env, &fx::PUB_ROOT),
            &nullifier,
            &recipient,
            &BytesN::from_array(&env, &fx::PUB_RECIPIENT),
            &amount,
        );
        assert!(again.is_err(), "double-spend rejected");
    }

    #[test]
    fn withdraw_unknown_root_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        // NOTE: 220-round MiMC over Fr is expensive on-chain — deposit/init
        // (tree hashing) EXCEED Soroban's default per-tx budget (measured:
        // reset_default() fails at initialize). These tests validate logic, not
        // gas. See docs/zk-mimc.md for the on-chain-cost finding + fallbacks
        // (Approach C off-chain tree, fewer MiMC rounds, or a shallower tree).
        // Withdraw itself (pairing verify only, no MiMC) fits the budget.
        env.cost_estimate().budget().reset_unlimited();
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let pool_id = env.register(ShieldedPool, ());
        let pool = ShieldedPoolClient::new(&env, &pool_id);
        pool.initialize(&sac.address(), &12u32, &vk(&env));

        let recipient = Address::generate(&env);
        let bogus_root = BytesN::from_array(&env, &[9u8; 32]);
        let res = pool.try_withdraw(
            &BytesN::from_array(&env, &fx::PROOF_NEG_A),
            &BytesN::from_array(&env, &fx::PROOF_B),
            &BytesN::from_array(&env, &fx::PROOF_C),
            &bogus_root,
            &BytesN::from_array(&env, &fx::PUB_NULLIFIER),
            &recipient,
            &BytesN::from_array(&env, &fx::PUB_RECIPIENT),
            &fx::AMOUNT,
        );
        assert!(res.is_err(), "unknown root rejected");
    }
}

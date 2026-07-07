//! On-chain MiMC over BLS12-381 `Fr` for the shielded pool (P3, #62).
//! Faithful port of lib/pool/mimc.ts (P1, #60): circomlib MiMCSponge (Feistel,
//! S-box x^5, 220 rounds) with Trexure's constants (mimc_constants.rs, generated
//! from the golden file). MUST reproduce the P1 golden vectors bit-for-bit — the
//! same hashes the circuit (#61) proves and the tree/nullifier commit to.

use soroban_sdk::crypto::bls12_381::{Bls12_381, Fr};
use soroban_sdk::{BytesN, Env, Vec};

use crate::mimc_constants::{MIMC_C, MIMC_ROUNDS};

/// Build an `Fr` from a 32-byte big-endian array.
pub fn fr_from_be(env: &Env, be: &[u8; 32]) -> Fr {
    Fr::from_bytes(BytesN::from_array(env, be))
}

fn zero(env: &Env) -> Fr {
    fr_from_be(env, &[0u8; 32])
}

/// Build the 220 round constants as `Fr`. Expensive (220 host conversions), so
/// callers in hot loops (the Merkle tree) build this ONCE per tx and pass it to
/// `hash2_c` rather than rebuilding per hash.
pub fn constants(env: &Env) -> Vec<Fr> {
    let mut v = Vec::new(env);
    for c in MIMC_C.iter() {
        v.push_back(fr_from_be(env, c));
    }
    v
}

fn pow5(bls: &Bls12_381, t: &Fr) -> Fr {
    let t2 = bls.fr_mul(t, t);
    let t4 = bls.fr_mul(&t2, &t2);
    bls.fr_mul(&t4, t)
}

/// One MiMC-Feistel permutation over (xL, xR), key = 0. Matches lib/pool/mimc.ts:
/// every round swaps EXCEPT the last, which keeps xL and folds t^5 into xR.
fn feistel(bls: &Bls12_381, c: &Vec<Fr>, xl_in: Fr, xr_in: Fr) -> (Fr, Fr) {
    let mut xl = xl_in;
    let mut xr = xr_in;
    for i in 0..MIMC_ROUNDS {
        // key = 0, so t = xl (i==0) else xl + C[i].
        let t = if i == 0 {
            xl.clone()
        } else {
            bls.fr_add(&xl, &c.get(i as u32).unwrap())
        };
        let t5 = pow5(bls, &t);
        if i < MIMC_ROUNDS - 1 {
            let new_xl = bls.fr_add(&xr, &t5);
            xr = xl;
            xl = new_xl;
        } else {
            xr = bls.fr_add(&xr, &t5); // keep xl (P1 last-round convention)
        }
    }
    (xl, xr)
}

/// MiMCSponge with `k = 0`, single squeezed output, using prebuilt constants.
fn sponge_with(env: &Env, bls: &Bls12_381, c: &Vec<Fr>, inputs: &Vec<Fr>) -> Fr {
    let mut xl = inputs.get(0).unwrap();
    let mut xr = zero(env);
    let (a, b) = feistel(bls, c, xl, xr);
    xl = a;
    xr = b;
    for i in 1..inputs.len() {
        xl = bls.fr_add(&xl, &inputs.get(i).unwrap());
        let (a, b) = feistel(bls, c, xl, xr);
        xl = a;
        xr = b;
    }
    xl
}

fn sponge(env: &Env, bls: &Bls12_381, inputs: &Vec<Fr>) -> Fr {
    sponge_with(env, bls, &constants(env), inputs)
}

/// Merkle-node hash (2 -> 1) with prebuilt constants — for the tree hot loop.
pub fn hash2_c(env: &Env, bls: &Bls12_381, c: &Vec<Fr>, left: Fr, right: Fr) -> Fr {
    let mut v = Vec::new(env);
    v.push_back(left);
    v.push_back(right);
    sponge_with(env, bls, c, &v)
}

/// Merkle-node hash (2 -> 1); builds constants internally (one-off / tests).
pub fn hash2(env: &Env, bls: &Bls12_381, left: Fr, right: Fr) -> Fr {
    let c = constants(env);
    hash2_c(env, bls, &c, left, right)
}

/// Deposit leaf commitment (3 -> 1).
pub fn commitment(env: &Env, bls: &Bls12_381, secret: Fr, nullifier: Fr, amount: Fr) -> Fr {
    let mut v = Vec::new(env);
    v.push_back(secret);
    v.push_back(nullifier);
    v.push_back(amount);
    sponge(env, bls, &v)
}

/// Public nullifier hash (1 -> 1).
pub fn nullifier_hash(env: &Env, bls: &Bls12_381, nullifier: Fr) -> Fr {
    let mut v = Vec::new(env);
    v.push_back(nullifier);
    sponge(env, bls, &v)
}

#[cfg(test)]
mod test {
    use super::*;

    fn be(hex: &str) -> [u8; 32] {
        let h = hex.trim_start_matches("0x").as_bytes();
        let mut out = [0u8; 32];
        for i in 0..32 {
            let hi = (h[i * 2] as char).to_digit(16).unwrap() as u8;
            let lo = (h[i * 2 + 1] as char).to_digit(16).unwrap() as u8;
            out[i] = (hi << 4) | lo;
        }
        out
    }
    fn small(env: &Env, n: u8) -> Fr {
        let mut b = [0u8; 32];
        b[31] = n;
        fr_from_be(env, &b)
    }

    #[test]
    fn mimc_reproduces_p1_golden_vectors() {
        let env = Env::default();
        let bls = env.crypto().bls12_381();

        // hash2(1, 2)
        let got = hash2(&env, &bls, small(&env, 1), small(&env, 2));
        let want = fr_from_be(&env, &be("464bb8a2f46053d0dc4c5c7b59f5adb5afa52c18052da305566f124f761a6e1d"));
        assert_eq!(got, want, "hash2(1,2)");

        // commitment(1, 2, 3)
        let got = commitment(&env, &bls, small(&env, 1), small(&env, 2), small(&env, 3));
        let want = fr_from_be(&env, &be("3e83b15a5efc98d6e3727bc73e98fca255ed2fd9d36c311b7093c576a350d84d"));
        assert_eq!(got, want, "commitment(1,2,3)");

        // nullifier_hash(42)
        let got = nullifier_hash(&env, &bls, small(&env, 42));
        let want = fr_from_be(&env, &be("5ee7897a505f08a536a876ec94f0e220e4261628eee3f0a672eb730d0db5b166"));
        assert_eq!(got, want, "nullifier_hash(42)");
    }
}

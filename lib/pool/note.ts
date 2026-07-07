import { randomBytes } from "node:crypto";

import { commitmentHash, nullifierHash, toField } from "./mimc";

/**
 * Shielded-pool deposit note (P4, #63). A note is the *claim credential* for a
 * deposit: whoever holds `{ secret, nullifier }` can withdraw the deposited
 * `amount` to any address (Tornado-style). The public `commitment` is what the
 * on-chain tree stores; `nullifierHash` is published at withdraw to prevent
 * double-spend. All values are BLS12-381 `Fr` residues, matching `mimc.ts`
 * (P1) — the same hashes the circuit (P2) proves and the contract (P3) commits.
 *
 * The serialized string (`trexure-note-v1-<hex>`) carries only the two secrets
 * plus the amount; commitment/nullifierHash are derived on parse. Treat it like
 * a bearer token — anyone with the string can claim the deposit.
 */
export type Note = {
  secret: bigint;
  nullifier: bigint;
  amount: bigint;
  commitment: bigint;
  nullifierHash: bigint;
};

export const NOTE_PREFIX = "trexure-note-v1-";

/** Draw a uniform BLS12-381 `Fr` residue from 32 fresh random bytes. */
function randomField(): bigint {
  return toField(BigInt("0x" + randomBytes(32).toString("hex")));
}

/** Derive the public fields (commitment, nullifierHash) from the secrets + amount. */
function withDerived(secret: bigint, nullifier: bigint, amount: bigint): Note {
  const s = toField(secret);
  const n = toField(nullifier);
  const a = toField(amount);
  return {
    secret: s,
    nullifier: n,
    amount: a,
    commitment: commitmentHash(s, n, a),
    nullifierHash: nullifierHash(n),
  };
}

/** Mint a fresh note for `amount` with random secret + nullifier. */
export function generateNote(amount: bigint): Note {
  return withDerived(randomField(), randomField(), amount);
}

const hex32 = (x: bigint): string => toField(x).toString(16).padStart(64, "0");

/** Encode a note as the portable `trexure-note-v1-<hex>` claim string. */
export function serializeNote(note: Note): string {
  return NOTE_PREFIX + hex32(note.secret) + hex32(note.nullifier) + hex32(note.amount);
}

/** Parse a `trexure-note-v1-<hex>` string back into a note (re-deriving publics). */
export function parseNote(s: string): Note {
  if (!s.startsWith(NOTE_PREFIX)) {
    throw new Error(`parseNote: bad prefix (expected ${NOTE_PREFIX})`);
  }
  const hex = s.slice(NOTE_PREFIX.length);
  if (!/^[0-9a-f]{192}$/.test(hex)) {
    throw new Error("parseNote: payload must be 192 lowercase hex chars (3 × 32-byte fields)");
  }
  const field = (i: number): bigint => BigInt("0x" + hex.slice(i * 64, i * 64 + 64));
  return withDerived(field(0), field(1), field(2));
}

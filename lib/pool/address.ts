import { StrKey } from "@stellar/stellar-sdk";
import { FR } from "../zk/commit";

/**
 * Encode a Stellar account public key (G... StrKey) as a single BLS12-381 `Fr`
 * element — the `recipient` public signal of the withdraw circuit (P2, #61).
 *
 * An ed25519 public key is 32 bytes (~256 bits) and exceeds the ~255-bit field,
 * so we reduce the big-endian key mod r. The reduction is *binding* for the
 * circuit's purpose (a relayer can't swap the payee): two distinct keys colliding
 * to the same `Fr` is a ~2^-255 event. The P3 contract MUST derive the same
 * field from the `recipient: Address` it pays out to.
 */
export function recipientToField(publicKeyG: string): bigint {
  const raw = StrKey.decodeEd25519PublicKey(publicKeyG); // 32-byte Buffer
  return (BigInt("0x" + Buffer.from(raw).toString("hex")) % FR + FR) % FR;
}

import { describe, it, expect } from "vitest";

import { commitmentHash } from "./mimc";
import { parseNote } from "./note";
import { prepareDeposit } from "./deposit";

describe("pool deposit — note minting (P4, #63)", () => {
  it("mints a note bound to the amount, with a round-trippable claim string", () => {
    const { note, noteString } = prepareDeposit(500n);
    expect(note.amount).toBe(500n);
    expect(note.commitment).toBe(commitmentHash(note.secret, note.nullifier, 500n));
    expect(parseNote(noteString)).toEqual(note);
  });

  it("encodes the commitment as the pool's BytesN<32> (32-byte big-endian)", () => {
    const { note, commitment } = prepareDeposit(1n);
    expect(commitment.length).toBe(32);
    expect(BigInt("0x" + commitment.toString("hex"))).toBe(note.commitment);
  });

  it("draws a fresh note per deposit", () => {
    expect(prepareDeposit(1n).note.secret).not.toBe(prepareDeposit(1n).note.secret);
  });
});

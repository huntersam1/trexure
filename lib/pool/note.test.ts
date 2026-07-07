import { describe, it, expect } from "vitest";

import { commitmentHash, nullifierHash, toField } from "./mimc";
import { generateNote, serializeNote, parseNote, NOTE_PREFIX } from "./note";

describe("pool note (P4, #63)", () => {
  it("generateNote binds commitment + nullifierHash consistently with mimc.ts", () => {
    const note = generateNote(1234560000n);
    expect(note.amount).toBe(1234560000n);
    expect(note.commitment).toBe(commitmentHash(note.secret, note.nullifier, note.amount));
    expect(note.nullifierHash).toBe(nullifierHash(note.nullifier));
    // secret/nullifier are canonical field residues.
    expect(note.secret).toBe(toField(note.secret));
    expect(note.nullifier).toBe(toField(note.nullifier));
  });

  it("generateNote draws fresh randomness each call", () => {
    const a = generateNote(1n);
    const b = generateNote(1n);
    expect(a.secret).not.toBe(b.secret);
    expect(a.nullifier).not.toBe(b.nullifier);
  });

  it("serializeNote produces a portable trexure-note-v1 credential", () => {
    const note = generateNote(42n);
    const s = serializeNote(note);
    expect(s.startsWith(NOTE_PREFIX)).toBe(true);
    // prefix + 3 field elements (secret,nullifier,amount) as 32-byte hex = 192 hex chars.
    expect(s.slice(NOTE_PREFIX.length)).toMatch(/^[0-9a-f]{192}$/);
  });

  it("parse(serialize(note)) round-trips exactly", () => {
    const note = generateNote(987654321n);
    const back = parseNote(serializeNote(note));
    expect(back).toEqual(note);
  });

  it("parseNote rejects a wrong prefix", () => {
    expect(() => parseNote("nope-" + "0".repeat(192))).toThrow(/prefix/i);
  });

  it("parseNote rejects a malformed payload length", () => {
    expect(() => parseNote(NOTE_PREFIX + "abcd")).toThrow(/length|hex/i);
  });
});

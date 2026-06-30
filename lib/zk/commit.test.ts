import { describe, it, expect } from "vitest";
import { deriveCommitment, hexCommitment, FR } from "./commit";

const vk = Buffer.from("a".repeat(64), "hex");

describe("deriveCommitment", () => {
  it("is deterministic for the same view key + binding id", () => {
    const a = deriveCommitment(vk, "intent_1");
    const b = deriveCommitment(vk, "intent_1");
    expect(a.commitment).toBe(b.commitment);
    expect(a.secret).toBe(b.secret);
    expect(a.blinding).toBe(b.blinding);
  });

  it("satisfies the circuit relation commitment = secret^2 + blinding (mod r)", () => {
    const { secret, blinding, commitment } = deriveCommitment(vk, "intent_2");
    expect((((secret * secret) % FR) + blinding) % FR).toBe(commitment);
    expect(commitment < FR).toBe(true);
  });

  it("differs across binding ids and across view keys", () => {
    expect(deriveCommitment(vk, "a").commitment).not.toBe(deriveCommitment(vk, "b").commitment);
    const vk2 = Buffer.from("b".repeat(64), "hex");
    expect(deriveCommitment(vk2, "a").commitment).not.toBe(deriveCommitment(vk, "a").commitment);
  });

  it("hexCommitment renders 0x + 64 hex (a 32-byte field element)", () => {
    expect(hexCommitment(deriveCommitment(vk, "x").commitment)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

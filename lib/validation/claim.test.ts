import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

import { claimSchema } from "@/lib/validation/pool";
import { NOTE_PREFIX } from "@/lib/pool/note";

const VALID_NOTE = NOTE_PREFIX + "a".repeat(192); // 3 × 32-byte fields, parseable
const G = Keypair.random().publicKey();

describe("claimSchema (P3 receiver claim)", () => {
  it("accepts a wallet claim with a valid note + Stellar address", () => {
    const r = claimSchema.safeParse({ note: VALID_NOTE, payout: { method: "wallet", address: G } });
    expect(r.success).toBe(true);
  });

  it("accepts a bank claim with all fields", () => {
    const r = claimSchema.safeParse({
      note: VALID_NOTE,
      payout: { method: "bank", bankCode: "BDO", accountName: "Alice Dev", accountNumber: "0012345678" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a note without the trexure prefix", () => {
    const r = claimSchema.safeParse({ note: "not-a-note", payout: { method: "wallet", address: G } });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed note body (wrong length)", () => {
    const r = claimSchema.safeParse({ note: NOTE_PREFIX + "abc", payout: { method: "wallet", address: G } });
    expect(r.success).toBe(false);
  });

  it("rejects a wallet claim with a non-Stellar address", () => {
    const r = claimSchema.safeParse({ note: VALID_NOTE, payout: { method: "wallet", address: "0xdeadbeef" } });
    expect(r.success).toBe(false);
  });

  it("rejects a bank claim missing the account number", () => {
    const r = claimSchema.safeParse({
      note: VALID_NOTE,
      payout: { method: "bank", bankCode: "BDO", accountName: "Alice", accountNumber: "" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown payout method", () => {
    const r = claimSchema.safeParse({ note: VALID_NOTE, payout: { method: "cash", address: G } });
    expect(r.success).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";

const VIEW_KEY = randomBytes(32);

// Force the labeled fallback path and inject a known shield key so shield and
// decryptWithViewKey use the same symmetric key.
vi.mock("@/lib/zk/spp-client", () => ({
  getShieldKey: vi.fn(async () => VIEW_KEY),
  isSppAvailable: vi.fn(async () => false),
  sppProve: vi.fn(),
  sppVerifyOnChain: vi.fn(),
}));

import { shield, decryptWithViewKey, verifyProofOnChain } from "@/lib/zk";
import { isSppAvailable, sppVerifyOnChain } from "@/lib/zk/spp-client";
import { deriveCommitment, hexCommitment } from "@/lib/zk/commit";

describe("shield → decryptWithViewKey", () => {
  it("round-trips the payload", async () => {
    const payload = { recipientRef: "rcp_1", amount: "2500.00", asset: "USDC" };
    const s = await shield(payload);

    expect(Buffer.isBuffer(s.encryptedPayload)).toBe(true);
    expect(s.payloadNonce.length).toBe(12);
    expect(s.proofHash).toMatch(/^0x[0-9a-f]{64}$/);

    const recovered = await decryptWithViewKey(VIEW_KEY, s.encryptedPayload, s.payloadNonce);
    expect(recovered).toEqual(payload);
  });

  it("a wrong view key fails to decrypt (auth tag mismatch)", async () => {
    const s = await shield({ a: 1 });
    await expect(
      decryptWithViewKey(randomBytes(32), s.encryptedPayload, s.payloadNonce),
    ).rejects.toThrow();
  });
});

describe("shield proving-live path (#46)", () => {
  it("commits proofHash to the REAL Groth16 commitment (verify-on-chain can pass)", async () => {
    // Proving live: shield runs the real snarkjs prover (local, no network) and
    // must return the commitment-derived proofHash, not the sha256 fallback.
    (isSppAvailable as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const intentId = "intent_zk_live_test";
    const s = await shield({ intentId, amount: "10.00" });

    const { commitment } = deriveCommitment(VIEW_KEY, intentId);
    expect(s.proofHash).toBe(hexCommitment(commitment));

    // still a decryptable payload
    const recovered = await decryptWithViewKey(VIEW_KEY, s.encryptedPayload, s.payloadNonce);
    expect(recovered).toEqual({ intentId, amount: "10.00" });
  });

  it("falls back to the labeled sha256 proofHash when proving is not live", async () => {
    // default mock is isSppAvailable → false
    const s = await shield({ intentId: "intent_fallback", amount: "1.00" });
    const { commitment } = deriveCommitment(VIEW_KEY, "intent_fallback");
    expect(s.proofHash).not.toBe(hexCommitment(commitment));
    expect(s.proofHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("verifyProofOnChain", () => {
  it("makes the REAL on-chain verify call (not bypassed) and returns its result", async () => {
    (sppVerifyOnChain as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ok = await verifyProofOnChain("0xabc123");
    expect(sppVerifyOnChain).toHaveBeenCalledWith("0xabc123");
    expect(ok).toBe(true);
  });
});

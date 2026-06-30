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
import { sppVerifyOnChain } from "@/lib/zk/spp-client";

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

describe("verifyProofOnChain", () => {
  it("makes the REAL on-chain verify call (not bypassed) and returns its result", async () => {
    (sppVerifyOnChain as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ok = await verifyProofOnChain("0xabc123");
    expect(sppVerifyOnChain).toHaveBeenCalledWith("0xabc123");
    expect(ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { shield } from "../../../lib/zk/stub";

describe("lib/zk/stub shield()", () => {
  it("returns encryptedPayload, payloadNonce (Buffers) and a hex proofHash", async () => {
    const out = await shield({ recipientRef: "rcp_1", amount: "2500.00", asset: "USDC" });
    expect(Buffer.isBuffer(out.encryptedPayload)).toBe(true);
    expect(Buffer.isBuffer(out.payloadNonce)).toBe(true);
    expect(out.payloadNonce).toHaveLength(12); // AES-GCM nonce length
    expect(out.proofHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a unique nonce per call (non-deterministic encryption)", async () => {
    const a = await shield({ x: 1 });
    const b = await shield({ x: 1 });
    expect(a.payloadNonce.equals(b.payloadNonce)).toBe(false);
  });
});

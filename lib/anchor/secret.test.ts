import { describe, it, expect, beforeEach, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { anchorConfig: { findFirst } } }));

// Decrypt is stubbed to echo which (ciphertext, nonce) it was handed, so we can
// assert the format dispatch without real crypto/keys.
const { aesDecrypt } = vi.hoisted(() => ({
  aesDecrypt: vi.fn((ct: Buffer, nonce: Buffer) => Buffer.from(`ct=${ct.toString("hex")};nonce=${nonce.toString("hex")}`)),
}));
vi.mock("@/lib/crypto/aes", () => ({ aesDecrypt }));

import { loadAnchorWebhookSecret } from "@/lib/anchor/secret";

beforeEach(() => vi.clearAllMocks());

describe("loadAnchorWebhookSecret (#143 H1)", () => {
  it("returns null when the tenant has no anchor config", async () => {
    findFirst.mockResolvedValue(null);
    expect(await loadAnchorWebhookSecret("t1", "mock-anchor")).toBeNull();
  });

  it("seed/signup layout: uses the nonce from config.nonce (base64)", async () => {
    const nonce = Buffer.from("0123456789ab"); // 12 bytes
    const ct = Buffer.from("deadbeef", "hex");
    findFirst.mockResolvedValue({ webhookSecret: ct, config: { nonce: nonce.toString("base64") } });

    const out = await loadAnchorWebhookSecret("t1", "mock-anchor");
    expect(aesDecrypt).toHaveBeenCalledWith(ct, nonce);
    expect(out).toBe(`ct=${ct.toString("hex")};nonce=${nonce.toString("hex")}`);
  });

  it("settings/rotate layout: splits the leading 12-byte nonce off the ciphertext", async () => {
    const nonce = Buffer.from("aabbccddeeff001122334455", "hex"); // 12 bytes
    const ct = Buffer.from("cafebabe", "hex");
    findFirst.mockResolvedValue({ webhookSecret: Buffer.concat([nonce, ct]), config: {} });

    const out = await loadAnchorWebhookSecret("t1", "mock-anchor");
    expect(aesDecrypt).toHaveBeenCalledWith(ct, nonce);
    expect(out).toBe(`ct=${ct.toString("hex")};nonce=${nonce.toString("hex")}`);
  });

  it("returns null when decryption throws (tamper / wrong key)", async () => {
    findFirst.mockResolvedValue({ webhookSecret: Buffer.from("short"), config: {} });
    aesDecrypt.mockImplementationOnce(() => {
      throw new Error("bad tag");
    });
    expect(await loadAnchorWebhookSecret("t1", "mock-anchor")).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so TEST_KEY exists before the hoisted vi.mock factory runs (TDZ).
const { TEST_KEY } = vi.hoisted(() => ({ TEST_KEY: Buffer.alloc(32, 7).toString("base64") }));
vi.mock("@/lib/env", () => ({ env: { MASTER_ENCRYPTION_KEY: TEST_KEY } }));

// In-memory ViewKey row captured from the mocked prisma.
let stored: { tenantId: string; encryptedKey: Buffer; nonce: Buffer } | null = null;
vi.mock("@/lib/db", () => ({
  prisma: {
    viewKey: {
      upsert: vi.fn(async ({ create }: any) => {
        stored = {
          tenantId: create.tenantId,
          encryptedKey: create.encryptedKey,
          nonce: create.nonce,
        };
        return stored;
      }),
      findUnique: vi.fn(async ({ where }: any) =>
        stored && stored.tenantId === where.tenantId ? stored : null,
      ),
    },
  },
}));

import { storeViewKey, loadViewKey } from "@/lib/crypto/viewkey";

const PLAINTEXT = Buffer.from("VIEWKEY-abc123-do-not-leak", "utf8");

describe("viewkey at-rest", () => {
  beforeEach(() => {
    stored = null;
  });

  it("stores the key encrypted (never as plaintext) and round-trips it", async () => {
    await storeViewKey("tenant_1", PLAINTEXT);
    expect(stored).not.toBeNull();
    // At-rest bytes must not equal the plaintext.
    expect(stored!.encryptedKey.equals(PLAINTEXT)).toBe(false);
    expect(stored!.nonce).toHaveLength(12);

    const loaded = await loadViewKey("tenant_1");
    expect(loaded.equals(PLAINTEXT)).toBe(true);
  });

  it("never serializes the plaintext key into the persisted record", async () => {
    await storeViewKey("tenant_1", PLAINTEXT);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(PLAINTEXT.toString("utf8"));
    expect(serialized).not.toContain(PLAINTEXT.toString("hex"));
    expect(serialized).not.toContain(PLAINTEXT.toString("base64"));
  });

  it("throws AppError(404) when the tenant has no view key", async () => {
    await expect(loadViewKey("missing")).rejects.toMatchObject({ status: 404 });
  });
});

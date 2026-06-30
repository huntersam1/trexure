import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = {
  id: string;
  tenantId: string;
  keyHash: string;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};
let rows: Row[] = [];
const updateSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(async ({ where }: any) =>
        rows.find((r) => r.keyHash === where.keyHash) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) => {
        updateSpy(where, data);
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { generateApiKey, hashApiKey, resolveApiKey } from "@/lib/auth/api-key";

describe("api-key generation", () => {
  it("returns a prefixed plaintext and its SHA-256 hash", () => {
    const { plaintext, keyHash } = generateApiKey();
    expect(plaintext.startsWith("trx_sk_")).toBe(true);
    expect(keyHash).toBe(hashApiKey(plaintext));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("never returns the same key twice", () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });
});

describe("resolveApiKey", () => {
  beforeEach(() => {
    rows = [];
    updateSpy.mockClear();
  });

  it("resolves a live key to its tenant and stamps lastUsedAt", async () => {
    const { plaintext, keyHash } = generateApiKey();
    rows.push({ id: "k1", tenantId: "tenant_1", keyHash, revokedAt: null, lastUsedAt: null });

    expect(await resolveApiKey(`Bearer ${plaintext}`)).toEqual({ tenantId: "tenant_1" });
    expect(updateSpy).toHaveBeenCalledWith(
      { id: "k1" },
      expect.objectContaining({ lastUsedAt: expect.any(Date) }),
    );
  });

  it("accepts the raw token without the Bearer prefix", async () => {
    const { plaintext, keyHash } = generateApiKey();
    rows.push({ id: "k2", tenantId: "tenant_2", keyHash, revokedAt: null, lastUsedAt: null });
    expect(await resolveApiKey(plaintext)).toEqual({ tenantId: "tenant_2" });
  });

  it("rejects a revoked key", async () => {
    const { plaintext, keyHash } = generateApiKey();
    rows.push({ id: "k3", tenantId: "t", keyHash, revokedAt: new Date(), lastUsedAt: null });
    expect(await resolveApiKey(`Bearer ${plaintext}`)).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("returns null for an unknown or malformed key", async () => {
    expect(await resolveApiKey("Bearer trx_sk_nope")).toBeNull();
    expect(await resolveApiKey("Bearer not-a-key")).toBeNull();
  });
});

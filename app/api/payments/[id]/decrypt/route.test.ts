import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const auditCreate = vi.fn(async (_arg: any) => ({}));
vi.mock("@/lib/auth/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({
  forTenant: vi.fn(() => ({
    payment: { findUnique },
    auditLog: { create: auditCreate },
  })),
}));

const requireSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireSession: () => requireSession() }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf: vi.fn() }));

const loadViewKey = vi.fn();
vi.mock("@/lib/crypto/viewkey", () => ({ loadViewKey: () => loadViewKey() }));

const decryptWithViewKey = vi.fn();
vi.mock("@/lib/zk", () => ({ decryptWithViewKey: (...a: any[]) => decryptWithViewKey(...a) }));

import { POST } from "@/app/api/payments/[id]/decrypt/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () =>
  new Request("https://app.test/api/payments/pay_1/decrypt", {
    method: "POST",
    headers: { origin: "https://app.test" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ id: "u1", tenantId: "tenantA", username: "admin", role: "ADMIN" });
});

describe("POST /api/payments/[id]/decrypt", () => {
  it("decrypts and NEVER serializes the view key into the response", async () => {
    findUnique.mockResolvedValue({
      id: "pay_1",
      encryptedPayload: Buffer.from("ct"),
      payloadNonce: Buffer.from("nonce"),
      proofHash: "0xabc",
      shielded: true,
    });
    loadViewKey.mockResolvedValue(Buffer.from("VIEWKEYSECRETBYTES"));
    decryptWithViewKey.mockResolvedValue({ recipientRef: "rcp_1", amount: "2500.00" });

    const res = await POST(req(), ctx("pay_1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.payload).toEqual({ recipientRef: "rcp_1", amount: "2500.00" });
    expect(body.privacy.viewKeyDisclosed).toBe(false);
    // the raw view-key bytes must appear NOWHERE in the response
    expect(JSON.stringify(body)).not.toContain("VIEWKEYSECRETBYTES");
  });

  it("writes a viewkey.decrypt audit log row targeting the payment", async () => {
    findUnique.mockResolvedValue({
      id: "pay_1",
      encryptedPayload: Buffer.from("ct"),
      payloadNonce: Buffer.from("n"),
      proofHash: "0x1",
      shielded: true,
    });
    loadViewKey.mockResolvedValue(Buffer.from("VK"));
    decryptWithViewKey.mockResolvedValue({ a: 1 });

    await POST(req(), ctx("pay_1"));
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0]![0].data).toMatchObject({
      action: "viewkey.decrypt",
      target: "pay_1",
      userId: "u1",
    });
  });

  it("cannot decrypt another tenant's payment (tenant-scoped 404)", async () => {
    findUnique.mockResolvedValue(null); // forTenant(tenantA) sees no such row
    const res = await POST(req(), ctx("pay_OTHER"));
    expect(res.status).toBe(404);
    expect(decryptWithViewKey).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

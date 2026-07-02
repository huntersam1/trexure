import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-test the shared post-validation signup sequence in isolation: provisioning
// is mocked (its DB behavior is covered by signup.test.ts) so we can lock the
// session wiring and the audit action name that both entry points now share.
const $transaction = vi.fn();
const auditCreate = vi.fn();
const createSession = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $transaction, auditLog: { create: auditCreate } },
}));
vi.mock("@/lib/auth/session", () => ({ createSession }));
vi.mock("@/lib/log", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  // provisionTenant runs prisma.$transaction and returns its result.
  $transaction.mockResolvedValue({ tenantId: "t_1", userId: "u_1", samplePaymentId: "p_1" });
});

describe("completeSignup", () => {
  it("opens a session and writes the auth.signup audit log for the provisioned tenant", async () => {
    const { completeSignup } = await import("@/lib/auth/signup");
    const out = await completeSignup(
      { tenantName: "Acme", username: "acme_admin", password: "correct-horse-battery-staple" },
      "1.2.3.4",
      "test-agent",
    );

    expect(out).toEqual({ tenantId: "t_1", userId: "u_1", samplePaymentId: "p_1" });
    expect(createSession).toHaveBeenCalledWith("u_1", "1.2.3.4", "test-agent");
    expect(auditCreate).toHaveBeenCalledWith({
      data: { tenantId: "t_1", userId: "u_1", action: "auth.signup", ip: "1.2.3.4" },
    });
  });
});

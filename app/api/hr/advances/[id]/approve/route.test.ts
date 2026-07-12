import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppError } from "@/lib/http/problem";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  approveAdvance: vi.fn(),
  markAdvanceDisbursed: vi.fn(),
  getEmployee: vi.fn(),
  createPoolBatch: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
  env: { ENABLE_POOL_RAIL: true },
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf: h.assertCsrf }));
vi.mock("@/lib/hr/advances", () => ({ approveAdvance: h.approveAdvance, markAdvanceDisbursed: h.markAdvanceDisbursed }));
vi.mock("@/lib/hr/employees", () => ({ getEmployee: h.getEmployee }));
vi.mock("@/lib/pool/batch", () => ({ createPoolBatch: h.createPoolBatch }));
vi.mock("@/lib/audit/log", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/env", () => ({ env: h.env }));

import { POST } from "@/app/api/hr/advances/[id]/approve/route";

const ctx = { params: Promise.resolve({ id: "adv_1" }) };
const req = () => new Request("http://localhost:3000/api/hr/advances/adv_1/approve", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.env.ENABLE_POOL_RAIL = true;
  h.requireAdmin.mockResolvedValue({ id: "u1", tenantId: "t1" });
  h.approveAdvance.mockResolvedValue({ id: "adv_1", employeeId: "emp_1", amount: "3" });
  h.getEmployee.mockResolvedValue({ name: "Maria", email: "maria@x.test" });
  h.markAdvanceDisbursed.mockResolvedValue({ id: "adv_1", status: "DISBURSED" });
  h.createPoolBatch.mockResolvedValue({ batchId: "b1", results: [{ ok: true, paymentId: "pay_1" }] });
});

describe("POST /api/hr/advances/[id]/approve — audit trail (#143)", () => {
  it("writes a hr.advance.disburse audit row on a successful payout", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "hr.advance.disburse",
        userId: "u1",
        tenantId: "t1",
        target: "adv_1",
        ip: "9.9.9.9",
      }),
    );
  });

  it("does NOT audit when the payout fails (502)", async () => {
    h.createPoolBatch.mockResolvedValue({ batchId: "b1", results: [{ ok: false }] });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(502);
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("does NOT audit when CSRF fails", async () => {
    h.assertCsrf.mockImplementationOnce(() => {
      throw new AppError(403, "Forbidden");
    });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(h.recordAudit).not.toHaveBeenCalled();
  });
});

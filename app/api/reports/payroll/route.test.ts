import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
  buildPayrollRegister: vi.fn(),
  payrollRegisterToCsv: vi.fn(() => "CSV_BODY"),
  payrollRegisterToPdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake-payroll")),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/audit/log", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/reports/payroll", () => ({
  buildPayrollRegister: h.buildPayrollRegister,
  payrollRegisterToCsv: h.payrollRegisterToCsv,
  payrollRegisterToPdf: h.payrollRegisterToPdf,
}));

import { GET } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const REGISTER = { totals: { disbursementCount: 4, claimed: 2, unclaimed: 1, failed: 1 } };

function req(qs: string): Request {
  return new Request(`http://localhost/api/reports/payroll?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.buildPayrollRegister.mockResolvedValue(REGISTER);
});

describe("GET /api/reports/payroll", () => {
  it("rejects a non-admin with 403 and never builds the register", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await GET(req("from=2026-07-01&to=2026-07-31"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(h.buildPayrollRegister).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    const res = await GET(req(""));
    expect(res.status).toBe(401);
  });

  it("scopes to a batch when batchId is supplied and audit-logs it", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("batchId=batch_9&format=csv"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="payroll-batch-batch_9.csv"',
    );
    expect(await res.text()).toBe("CSV_BODY");
    expect(h.buildPayrollRegister).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ batchId: "batch_9", range: null }),
    );
    const entry = h.recordAudit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "report.generate", tenantId: "t1", userId: "u_admin" });
    expect(entry.metadata).toMatchObject({ report: "payroll", batchId: "batch_9" });
  });

  it("falls back to a date range when no batchId is supplied", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="payroll-2026-07-01_2026-07-31.csv"',
    );
    const arg = h.buildPayrollRegister.mock.calls[0]![1];
    expect(arg.batchId).toBeNull();
    expect(arg.range).not.toBeNull();
  });

  it("streams a PDF when format=pdf", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("batchId=batch_9&format=pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(".pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(h.payrollRegisterToPdf).toHaveBeenCalledOnce();
  });
});

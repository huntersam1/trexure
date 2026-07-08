import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
  buildReconciliationStatement: vi.fn(),
  reconciliationToCsv: vi.fn(() => "CSV_BODY"),
  reconciliationToPdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake-report")),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/audit/log", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/reports/reconciliation", () => ({
  buildReconciliationStatement: h.buildReconciliationStatement,
  reconciliationToCsv: h.reconciliationToCsv,
  reconciliationToPdf: h.reconciliationToPdf,
}));

import { GET } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const STATEMENT = { totals: { settledCount: 2, exceptionCount: 1 } };

function req(qs: string): Request {
  return new Request(`http://localhost/api/reports/reconciliation?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.buildReconciliationStatement.mockResolvedValue(STATEMENT);
});

describe("GET /api/reports/reconciliation", () => {
  it("rejects a non-admin with 403 and never builds the report", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await GET(req("from=2026-07-01&to=2026-07-31"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(h.buildReconciliationStatement).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    const res = await GET(req(""));
    expect(res.status).toBe(401);
  });

  it("streams a tenant-scoped CSV for an admin and audit-logs the generation", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=csv"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="reconciliation-2026-07-01_2026-07-31.csv"',
    );
    expect(await res.text()).toBe("CSV_BODY");

    // Built for the admin's tenant only.
    expect(h.buildReconciliationStatement).toHaveBeenCalledWith("t1", expect.anything());
    expect(h.recordAudit).toHaveBeenCalledTimes(1);
    const entry = h.recordAudit.mock.calls[0]![0];
    expect(entry).toMatchObject({
      action: "report.generate",
      tenantId: "t1",
      userId: "u_admin",
    });
    expect(entry.metadata).toMatchObject({ report: "reconciliation", format: "csv" });
  });

  it("streams a PDF when format=pdf", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=pdf"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(".pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(h.reconciliationToPdf).toHaveBeenCalledOnce();
  });

  it("defaults to the current month when no range is supplied", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    // A default range still produces a valid filename + audit entry.
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="reconciliation-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(h.recordAudit).toHaveBeenCalledOnce();
  });
});

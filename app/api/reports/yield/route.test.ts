import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
  buildYieldAttribution: vi.fn(),
  yieldAttributionToCsv: vi.fn(() => "CSV_BODY"),
  yieldAttributionToPdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake-report")),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/audit/log", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/reports/yield-attribution", () => ({
  buildYieldAttribution: h.buildYieldAttribution,
  yieldAttributionToCsv: h.yieldAttributionToCsv,
  yieldAttributionToPdf: h.yieldAttributionToPdf,
}));

import { GET } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const REPORT = { totals: { positionCount: 3 } };

function req(qs: string): Request {
  return new Request(`http://localhost/api/reports/yield?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.buildYieldAttribution.mockResolvedValue(REPORT);
});

describe("GET /api/reports/yield", () => {
  it("rejects a non-admin with 403 and never builds the report", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await GET(req("from=2026-07-01&to=2026-07-31"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(h.buildYieldAttribution).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("streams a tenant-scoped CSV for an admin and audit-logs the generation", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=csv"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="yield-attribution-2026-07-01_2026-07-31.csv"',
    );
    expect(await res.text()).toBe("CSV_BODY");

    expect(h.buildYieldAttribution).toHaveBeenCalledWith("t1", expect.anything());
    expect(h.recordAudit).toHaveBeenCalledTimes(1);
    const entry = h.recordAudit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "report.generate", tenantId: "t1", userId: "u_admin" });
    expect(entry.metadata).toMatchObject({ report: "yield", format: "csv" });
  });

  it("streams a PDF when format=pdf", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(h.yieldAttributionToPdf).toHaveBeenCalledOnce();
  });
});

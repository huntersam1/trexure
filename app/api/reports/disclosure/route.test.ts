import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("@/lib/auth/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => null) }));
vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  buildDisclosurePack: vi.fn(),
  disclosurePackToCsv: vi.fn(() => "CSV_BODY"),
  disclosurePackToJson: vi.fn(() => '{"json":true}'),
  disclosurePackToPdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake-disclosure")),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/reports/disclosure", () => ({
  buildDisclosurePack: h.buildDisclosurePack,
  disclosurePackToCsv: h.disclosurePackToCsv,
  disclosurePackToJson: h.disclosurePackToJson,
  disclosurePackToPdf: h.disclosurePackToPdf,
}));

import { GET } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const PACK = { counterparty: null, paymentCount: 2, revealedCount: 2, entries: [] };

function req(qs: string): Request {
  return new Request(`http://localhost/api/reports/disclosure?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.buildDisclosurePack.mockResolvedValue(PACK);
});

describe("GET /api/reports/disclosure", () => {
  it("rejects a non-admin with 403 and never decrypts anything", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await GET(req("from=2026-07-01&to=2026-07-31"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(h.buildDisclosurePack).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    const res = await GET(req(""));
    expect(res.status).toBe(401);
  });

  it("rejects an explicit cross-site request with 403 and never decrypts", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const r = new Request("http://localhost/api/reports/disclosure?from=2026-07-01&to=2026-07-31", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    const res = await GET(r);
    expect(res.status).toBe(403);
    expect(h.buildDisclosurePack).not.toHaveBeenCalled();
  });

  it("streams a tenant-scoped CSV appendix and passes the actor to the builder", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=csv"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="disclosure-2026-07-01_2026-07-31.csv"',
    );
    expect(await res.text()).toBe("CSV_BODY");
    // Built for the admin's tenant with the admin as the disclosing actor.
    expect(h.buildDisclosurePack).toHaveBeenCalledWith(
      "t1",
      expect.anything(),
      expect.objectContaining({ actorUserId: "u_admin", counterparty: null }),
    );
  });

  it("forwards a counterparty filter and slugs it into the filename", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.buildDisclosurePack.mockResolvedValue({ ...PACK, counterparty: "Acme Vendor" });
    const res = await GET(req("from=2026-07-01&to=2026-07-31&counterparty=Acme%20Vendor&format=csv"));

    expect(res.status).toBe(200);
    expect(h.buildDisclosurePack).toHaveBeenCalledWith(
      "t1",
      expect.anything(),
      expect.objectContaining({ counterparty: "Acme Vendor" }),
    );
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="disclosure-2026-07-01_2026-07-31-Acme_Vendor.csv"',
    );
  });

  it("streams a PDF when format=pdf", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(".pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(h.disclosurePackToPdf).toHaveBeenCalledOnce();
  });

  it("streams JSON when format=json", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req("from=2026-07-01&to=2026-07-31&format=json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain(".json");
    expect(await res.text()).toBe('{"json":true}');
  });

  it("defaults to the current month + CSV when no range/format is supplied", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="disclosure-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });
});

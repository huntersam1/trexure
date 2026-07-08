import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireSession: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
  buildAttestation: vi.fn(),
  attestationToJson: vi.fn(() => '{"att":true}'),
  attestationToPdf: vi.fn(async () => Buffer.from("%PDF-1.7 fake-attestation")),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: h.requireSession }));
vi.mock("@/lib/audit/log", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/reports/attestation", () => ({
  buildAttestation: h.buildAttestation,
  attestationToJson: h.attestationToJson,
  attestationToPdf: h.attestationToPdf,
}));

import { GET } from "./route";

const MEMBER = { id: "u_member", username: "member", role: "MEMBER" as const, tenantId: "t1" };
const ATT = { rail: "fiat", paymentId: "pay_1" };

function req(qs: string): Request {
  return new Request(`http://localhost/api/reports/attestation?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.buildAttestation.mockResolvedValue(ATT);
});

describe("GET /api/reports/attestation", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    h.requireSession.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    const res = await GET(req("paymentId=pay_1"));
    expect(res.status).toBe(401);
    expect(h.buildAttestation).not.toHaveBeenCalled();
  });

  it("400s when paymentId is missing", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    const res = await GET(req("format=pdf"));
    expect(res.status).toBe(400);
    expect(h.buildAttestation).not.toHaveBeenCalled();
  });

  it("propagates a 409 for a non-settled payment", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    h.buildAttestation.mockRejectedValue(new AppError(409, "Not settled", "…"));
    const res = await GET(req("paymentId=pay_1"));
    expect(res.status).toBe(409);
  });

  it("propagates a 404 for a cross-tenant / unknown payment", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    h.buildAttestation.mockRejectedValue(new AppError(404, "Payment not found", "…"));
    const res = await GET(req("paymentId=pay_x"));
    expect(res.status).toBe(404);
  });

  it("streams a tenant-scoped PDF for a member and audit-logs the generation", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    const res = await GET(req("paymentId=pay_1&format=pdf"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="attestation-pay_1.pdf"',
    );
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(h.buildAttestation).toHaveBeenCalledWith("t1", "pay_1");
    const entry = h.recordAudit.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "report.generate", tenantId: "t1", userId: "u_member" });
    expect(entry.metadata).toMatchObject({ report: "attestation", paymentId: "pay_1" });
  });

  it("streams JSON when format=json", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    const res = await GET(req("paymentId=pay_1&format=json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain(".json");
    expect(await res.text()).toBe('{"att":true}');
  });
});

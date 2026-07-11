import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  requestConversion: vi.fn(),
  listConversions: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: h.requireSession, requireAdmin: h.requireAdmin }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf: h.assertCsrf }));
vi.mock("@/lib/hr/conversions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr/conversions")>("@/lib/hr/conversions");
  return { conversionRequestInput: actual.conversionRequestInput, requestConversion: h.requestConversion, listConversions: h.listConversions };
});
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));

import { GET, POST } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const MEMBER = { id: "u_member", username: "member", role: "MEMBER" as const, tenantId: "t1" };

const post = (body: unknown) =>
  new Request("http://localhost/api/hr/conversions", { method: "POST", body: JSON.stringify(body) });
const valid = { employeeId: "e1", packageItemId: "pi1", notionalAmount: "1000" };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/hr/conversions", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    h.requireSession.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    const res = await GET(new Request("http://localhost/api/hr/conversions"));
    expect(res.status).toBe(401);
  });

  it("lists for a session, honoring the employeeId filter", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    h.listConversions.mockResolvedValue([{ id: "c1" }]);
    const res = await GET(new Request("http://localhost/api/hr/conversions?employeeId=e1"));
    expect(res.status).toBe(200);
    expect(h.listConversions).toHaveBeenCalledWith("t1", "e1");
  });
});

describe("POST /api/hr/conversions", () => {
  it("rejects a non-admin with 403 and never requests", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await POST(post(valid));
    expect(res.status).toBe(403);
    expect(h.requestConversion).not.toHaveBeenCalled();
  });

  it("400s on invalid input (non-positive amount)", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await POST(post({ employeeId: "e1", packageItemId: "pi1", notionalAmount: "-5" }));
    expect(res.status).toBe(400);
    expect(h.requestConversion).not.toHaveBeenCalled();
  });

  it("requests for an admin and returns 201", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.requestConversion.mockResolvedValue({ id: "c1", status: "REQUESTED" });
    const res = await POST(post(valid));
    expect(res.status).toBe(201);
    expect(h.assertCsrf).toHaveBeenCalled();
    expect(h.requestConversion).toHaveBeenCalledWith("t1", "e1", "u_admin", { packageItemId: "pi1", notionalAmount: "1000" });
  });
});

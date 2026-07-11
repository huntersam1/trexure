import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  requestAdvance: vi.fn(),
  listAdvances: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: h.requireSession, requireAdmin: h.requireAdmin }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf: h.assertCsrf }));
vi.mock("@/lib/hr/advances", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr/advances")>("@/lib/hr/advances");
  return { advanceRequestInput: actual.advanceRequestInput, requestAdvance: h.requestAdvance, listAdvances: h.listAdvances };
});
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));

import { GET, POST } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const MEMBER = { id: "u_member", username: "member", role: "MEMBER" as const, tenantId: "t1" };
const post = (body: unknown) =>
  new Request("http://localhost/api/hr/advances", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/hr/advances", () => {
  it("401s an unauthenticated caller", async () => {
    h.requireSession.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    expect((await GET(new Request("http://localhost/api/hr/advances"))).status).toBe(401);
  });
  it("lists for a session with the employeeId filter", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    h.listAdvances.mockResolvedValue([{ id: "a1" }]);
    const res = await GET(new Request("http://localhost/api/hr/advances?employeeId=e1"));
    expect(res.status).toBe(200);
    expect(h.listAdvances).toHaveBeenCalledWith("t1", "e1");
  });
});

describe("POST /api/hr/advances", () => {
  it("403s a non-admin and never requests", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await POST(post({ employeeId: "e1", amount: "100" }));
    expect(res.status).toBe(403);
    expect(h.requestAdvance).not.toHaveBeenCalled();
  });
  it("400s a non-positive amount", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await POST(post({ employeeId: "e1", amount: "0" }));
    expect(res.status).toBe(400);
    expect(h.requestAdvance).not.toHaveBeenCalled();
  });
  it("requests for an admin and returns 201", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.requestAdvance.mockResolvedValue({ id: "a1", status: "REQUESTED" });
    const res = await POST(post({ employeeId: "e1", amount: "100" }));
    expect(res.status).toBe(201);
    expect(h.assertCsrf).toHaveBeenCalled();
    expect(h.requestAdvance).toHaveBeenCalledWith("t1", "u_admin", { employeeId: "e1", amount: "100" });
  });
});

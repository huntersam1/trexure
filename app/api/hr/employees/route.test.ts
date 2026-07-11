import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/http/problem";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  listEmployees: vi.fn(),
  onboardEmployee: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: h.requireSession, requireAdmin: h.requireAdmin }));
vi.mock("@/lib/auth/csrf", () => ({ assertCsrf: h.assertCsrf }));
vi.mock("@/lib/hr/employees", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr/employees")>("@/lib/hr/employees");
  return { onboardInput: actual.onboardInput, listEmployees: h.listEmployees, onboardEmployee: h.onboardEmployee };
});
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));

import { GET, POST } from "./route";

const ADMIN = { id: "u_admin", username: "admin", role: "ADMIN" as const, tenantId: "t1" };
const MEMBER = { id: "u_member", username: "member", role: "MEMBER" as const, tenantId: "t1" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/hr/employees", { method: "POST", body: JSON.stringify(body) });
}
const validOnboard = {
  name: "Maria",
  email: "maria@acme.test",
  package: { items: [{ type: "BASE_SALARY", label: "Base", amount: "50000", currency: "PHP" }] },
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/hr/employees", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    h.requireSession.mockRejectedValue(new AppError(401, "Unauthorized", "Authentication required."));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(h.listEmployees).not.toHaveBeenCalled();
  });

  it("returns the tenant's employees for a session", async () => {
    h.requireSession.mockResolvedValue(MEMBER);
    h.listEmployees.mockResolvedValue([{ id: "e1" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ employees: [{ id: "e1" }] });
    expect(h.listEmployees).toHaveBeenCalledWith("t1");
  });
});

describe("POST /api/hr/employees", () => {
  it("rejects a non-admin with 403 and never onboards", async () => {
    h.requireAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Administrator role required."));
    const res = await POST(post(validOnboard));
    expect(res.status).toBe(403);
    expect(h.onboardEmployee).not.toHaveBeenCalled();
  });

  it("400s on invalid input (no package items) without calling the service", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    const res = await POST(post({ name: "X", email: "x@y.z", package: { items: [] } }));
    expect(res.status).toBe(400);
    expect(h.onboardEmployee).not.toHaveBeenCalled();
  });

  it("onboards for an admin and returns 201", async () => {
    h.requireAdmin.mockResolvedValue(ADMIN);
    h.onboardEmployee.mockResolvedValue({ id: "e1", name: "Maria" });
    const res = await POST(post(validOnboard));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ employee: { id: "e1", name: "Maria" } });
    expect(h.assertCsrf).toHaveBeenCalled();
    expect(h.onboardEmployee).toHaveBeenCalledWith("t1", "u_admin", expect.objectContaining({ email: "maria@acme.test" }));
  });
});

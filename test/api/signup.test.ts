import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../lib/http/problem";

const provisionTenant = vi.fn();
const createSession = vi.fn();
const rateLimit = vi.fn();
const auditCreate = vi.fn();

vi.mock("../../lib/auth/signup", () => ({ provisionTenant }));
vi.mock("../../lib/auth/session", () => ({ createSession }));
vi.mock("../../lib/auth/rate-limit", () => ({ rateLimit }));
vi.mock("../../lib/db", () => ({ prisma: { auditLog: { create: auditCreate } } }));
vi.mock("../../lib/log", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  provisionTenant.mockResolvedValue({ tenantId: "t_new", userId: "u_new", samplePaymentId: "p_new" });
});

const makeReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const validBody = {
  tenantName: "Acme Treasury",
  username: "acme_admin",
  password: "a-long-enough-password",
};

describe("POST /api/auth/signup", () => {
  it("provisions, creates a session, audit-logs, and returns 201", async () => {
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody, { "x-forwarded-for": "1.2.3.4" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, tenantId: "t_new", samplePaymentId: "p_new" });
    expect(provisionTenant).toHaveBeenCalledWith(validBody);
    expect(createSession).toHaveBeenCalledWith("u_new", "1.2.3.4", undefined);
    expect(auditCreate).toHaveBeenCalledWith({
      data: { tenantId: "t_new", userId: "u_new", action: "auth.signup", ip: "1.2.3.4" },
    });
  });

  it("rejects a weak password with 422 problem+json before provisioning", async () => {
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq({ ...validBody, password: "short" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  it("rate-limits signups per IP with 429 + Retry-After", async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 1800 });
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1800");
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  it("maps a duplicate username to 409 problem+json without a session", async () => {
    provisionTenant.mockRejectedValueOnce(
      new AppError(409, "Username unavailable", "That username is already taken."),
    );
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns a generic 500 problem+json on unexpected failure (no leakage)", async () => {
    provisionTenant.mockRejectedValueOnce(new Error("db exploded: secret detail"));
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail?: string };
    expect(body.detail).toBe("Could not create the account.");
  });
});

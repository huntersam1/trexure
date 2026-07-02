import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../lib/http/problem";

const completeSignup = vi.fn();
const rateLimit = vi.fn();

// The route delegates provision + session + audit to completeSignup (unit-tested
// against a real DB in test/lib/auth/signup.test.ts); here we assert the route's
// own responsibility: parse, throttle, delegate, and map results/errors.
vi.mock("../../lib/auth/signup", () => ({
  completeSignup,
  SIGNUP_RATE_LIMIT: { limit: 5, windowSec: 3600 },
  signupRateLimitKey: (ip: string) => `signup:ip:${ip}`,
}));
vi.mock("../../lib/auth/rate-limit", () => ({ rateLimit }));
vi.mock("../../lib/log", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  completeSignup.mockResolvedValue({ tenantId: "t_new", userId: "u_new", samplePaymentId: "p_new" });
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
  it("delegates to completeSignup and returns 201", async () => {
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody, { "x-forwarded-for": "1.2.3.4" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, tenantId: "t_new", samplePaymentId: "p_new" });
    expect(completeSignup).toHaveBeenCalledWith(validBody, "1.2.3.4", undefined);
  });

  it("rejects a weak password with 422 problem+json before provisioning", async () => {
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq({ ...validBody, password: "short" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(completeSignup).not.toHaveBeenCalled();
  });

  it("rate-limits signups per IP with 429 + Retry-After", async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 1800 });
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1800");
    expect(completeSignup).not.toHaveBeenCalled();
  });

  it("maps a duplicate username to 409 problem+json", async () => {
    completeSignup.mockRejectedValueOnce(
      new AppError(409, "Username unavailable", "That username is already taken."),
    );
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(409);
  });

  it("returns a generic 500 problem+json on unexpected failure (no leakage)", async () => {
    completeSignup.mockRejectedValueOnce(new Error("db exploded: secret detail"));
    const { POST } = await import("../../app/api/auth/signup/route");
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { detail?: string };
    expect(body.detail).toBe("Could not create the account.");
  });
});

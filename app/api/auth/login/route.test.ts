import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above top-level declarations, and these factories reference
// the mock fns eagerly, so the fns must be created via vi.hoisted() to exist
// before the hoisted mocks run (avoids a TDZ ReferenceError).
const { createSession, rateLimit, verifyPassword, auditCreate, findUnique } = vi.hoisted(() => ({
  createSession: vi.fn(async () => undefined),
  rateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  verifyPassword: vi.fn(async (_hash: string, plain: string) => plain === "correct-password"),
  auditCreate: vi.fn(async () => ({})),
  findUnique: vi.fn(async ({ where }: any) =>
    where.username === "admin"
      ? { id: "u1", username: "admin", passwordHash: "$argon2id$stored", role: "ADMIN", tenantId: "t1" }
      : null,
  ),
}));

vi.mock("@/lib/auth/session", () => ({ createSession }));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit }));
vi.mock("@/lib/auth/password", () => ({ verifyPassword, getDummyHash: async () => "$argon2id$dummy" }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique }, auditLog: { create: auditCreate } } }));
vi.mock("@/lib/log", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from "@/app/api/auth/login/route";

function loginReq(body: unknown): Request {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    // user-agent included so createSession's 3rd arg is a real string (expect.anything()).
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "9.9.9.9",
      "user-agent": "vitest-agent",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and audits auth.login", async () => {
    const res = await POST(loginReq({ username: "admin", password: "correct-password" }));
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith("u1", "9.9.9.9", expect.anything());
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "auth.login", userId: "u1" }) }),
    );
  });

  it("returns a generic 401 for a wrong password (no enumeration) and no session", async () => {
    const res = await POST(loginReq({ username: "admin", password: "nope" }));
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns the same generic 401 for an unknown user (constant-time verify still runs)", async () => {
    const res = await POST(loginReq({ username: "ghost", password: "whatever" }));
    expect(res.status).toBe(401);
    expect(verifyPassword).toHaveBeenCalled(); // dummy-hash compare keeps timing uniform
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects unknown body keys with 400", async () => {
    const res = await POST(loginReq({ username: "admin", password: "x", evil: true }));
    expect(res.status).toBe(400);
  });

  it("throttles with 429 + Retry-After when the limiter blocks", async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 42 });
    const res = await POST(loginReq({ username: "admin", password: "correct-password" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(createSession).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  headers: vi.fn(),
  assertSameOrigin: vi.fn(),
  issueCsrfToken: vi.fn(() => "csrf"),
  findUnique: vi.fn(),
  verifyPassword: vi.fn(),
  getDummyHash: vi.fn(async () => "$argon2id$dummy"),
  rateLimit: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: h.headers,
  cookies: async () => ({ set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/csrf", () => ({
  assertSameOrigin: h.assertSameOrigin,
  issueCsrfToken: h.issueCsrfToken,
  CSRF_COOKIE_NAME: "__Host-trexure_csrf",
}));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: h.verifyPassword, getDummyHash: h.getDummyHash }));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/auth/session", () => ({ createSession: h.createSession }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: h.findUnique } } }));

import { loginAction } from "@/app/(auth)/login/actions";

function fd(username = "alice", password = "correct-horse-battery") {
  const f = new FormData();
  f.set("username", username);
  f.set("password", password);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.headers.mockResolvedValue(new Headers());
  h.assertSameOrigin.mockReturnValue(true);
  h.rateLimit.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
});

describe("loginAction anti-enumeration (#143)", () => {
  it("still runs a verify (dummy hash) for an unknown username — no timing oracle", async () => {
    h.findUnique.mockResolvedValue(null); // unknown user
    h.verifyPassword.mockResolvedValue(false);

    const res = await loginAction({ error: null }, fd());
    expect(res.error).toBe("Invalid username or password.");
    // The dummy hash was used and a verify still ran (uniform timing).
    expect(h.getDummyHash).toHaveBeenCalledTimes(1);
    expect(h.verifyPassword).toHaveBeenCalledWith("$argon2id$dummy", "correct-horse-battery");
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it("throttles: returns a rate-limit error without querying the user or verifying", async () => {
    h.rateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 120 });
    const res = await loginAction({ error: null }, fd());
    expect(res.error).toMatch(/too many login attempts/i);
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.verifyPassword).not.toHaveBeenCalled();
  });
});

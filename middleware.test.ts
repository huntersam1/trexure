import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const COOKIE = "__Host-trexure_session";

function req(path: string, opts: { cookie?: boolean } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", `${COOKIE}=sometoken`);
  return new NextRequest(new URL(`http://localhost:3000${path}`), { headers });
}

describe("middleware", () => {
  it("lets public routes through and stamps security headers", () => {
    const res = middleware(req("/login"));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(res.headers.get("Content-Security-Policy")).toContain("'nonce-");
    expect(res.headers.get("Content-Security-Policy")).not.toContain("'unsafe-inline' 'self' script");
  });

  it("allows webhook and health routes without a session", () => {
    expect(middleware(req("/api/webhooks/fiat")).status).toBe(200);
    expect(middleware(req("/api/health")).status).toBe(200);
    expect(middleware(req("/api/auth/login")).status).toBe(200);
  });

  it("allows the self-serve signup page and API without a session (#33)", () => {
    expect(middleware(req("/signup")).status).toBe(200);
    expect(middleware(req("/api/auth/signup")).status).toBe(200);
  });

  it("redirects an unauthenticated page request to /login", () => {
    const res = middleware(req("/payments"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("returns 401 problem+json for an unauthenticated API request", () => {
    const res = middleware(req("/api/payments"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("lets an authenticated request through", () => {
    expect(middleware(req("/payments", { cookie: true })).status).toBe(200);
  });
});

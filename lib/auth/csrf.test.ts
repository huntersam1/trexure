import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { CSRF_SECRET: "unit-test-csrf-secret-at-least-32-bytes-long!!", APP_URL: "http://localhost:3000" },
}));

import { issueCsrfToken, assertCsrf, forwardedCookieHeader, CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { AppError } from "@/lib/http/problem";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers });
}

describe("csrf", () => {
  it("accepts a request whose header token matches the cookie and same-origin", () => {
    const token = issueCsrfToken();
    const req = reqWith({
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": token,
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
    });
    expect(() => assertCsrf(req)).not.toThrow();
  });

  it("rejects a cross-site request", () => {
    const token = issueCsrfToken();
    const req = reqWith({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      "x-csrf-token": token,
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
    });
    expect(() => assertCsrf(req)).toThrow(AppError);
  });

  it("rejects a mismatched double-submit token", () => {
    const a = issueCsrfToken();
    const b = issueCsrfToken();
    const req = reqWith({
      "sec-fetch-site": "same-origin",
      "x-csrf-token": a,
      cookie: `${CSRF_COOKIE_NAME}=${b}`,
    });
    expect(() => assertCsrf(req)).toThrow(AppError);
  });

  it("rejects a forged/tampered signature", () => {
    const req = reqWith({
      "sec-fetch-site": "same-origin",
      "x-csrf-token": "rawvalue.deadbeefsignature",
      cookie: `${CSRF_COOKIE_NAME}=rawvalue.deadbeefsignature`,
    });
    expect(() => assertCsrf(req)).toThrow(AppError);
  });

  it("rejects when the token is missing entirely", () => {
    const req = reqWith({ "sec-fetch-site": "same-origin" });
    expect(() => assertCsrf(req)).toThrow(AppError);
  });

  it("rejects a forwarded header carrying a stale cookie before the fresh one (regression #29)", () => {
    const stale = issueCsrfToken();
    const fresh = issueCsrfToken();
    const req = reqWith({
      "sec-fetch-site": "same-origin",
      "x-csrf-token": fresh,
      cookie: `${CSRF_COOKIE_NAME}=${stale}; ${CSRF_COOKIE_NAME}=${fresh}`,
    });
    expect(() => assertCsrf(req)).toThrow(AppError);
  });
});

describe("forwardedCookieHeader", () => {
  it("drops any existing CSRF cookie and appends the fresh one exactly once", () => {
    const stale = issueCsrfToken();
    const fresh = issueCsrfToken();
    const header = forwardedCookieHeader(
      [
        { name: "trexure_session", value: "sess-abc" },
        { name: CSRF_COOKIE_NAME, value: stale },
      ],
      fresh,
    );
    expect(header).toBe(`trexure_session=sess-abc; ${CSRF_COOKIE_NAME}=${fresh}`);
  });

  it("produces a header that assertCsrf accepts even when the jar held a stale token (regression #29)", () => {
    const stale = issueCsrfToken();
    const fresh = issueCsrfToken();
    const req = reqWith({
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": fresh,
      cookie: forwardedCookieHeader([{ name: CSRF_COOKIE_NAME, value: stale }], fresh),
    });
    expect(() => assertCsrf(req)).not.toThrow();
  });

  it("works with an empty jar", () => {
    const fresh = issueCsrfToken();
    expect(forwardedCookieHeader([], fresh)).toBe(`${CSRF_COOKIE_NAME}=${fresh}`);
  });

  it("re-encodes values so a ';' in a decoded value can't split the header", () => {
    const fresh = issueCsrfToken();
    const header = forwardedCookieHeader(
      [{ name: "trexure_session", value: "a;b=c" }],
      fresh,
    );
    // The raw ';' must be percent-encoded, leaving exactly two pairs.
    expect(header).toBe(`trexure_session=a%3Bb%3Dc; ${CSRF_COOKIE_NAME}=${fresh}`);
    expect(header.split(";").length).toBe(2);
  });
});

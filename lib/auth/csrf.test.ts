import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { CSRF_SECRET: "unit-test-csrf-secret-at-least-32-bytes-long!!", APP_URL: "http://localhost:3000" },
}));

import { issueCsrfToken, assertCsrf, CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
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
});

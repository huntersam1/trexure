import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/http/problem";

export const CSRF_COOKIE_NAME = "__Host-trexure_csrf";

const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

function sign(raw: string): string {
  return createHmac("sha256", env.CSRF_SECRET).update(raw).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function issueCsrfToken(): string {
  const raw = randomBytes(32).toString("base64url");
  return `${raw}.${sign(raw)}`;
}

/**
 * Same-origin guard for server actions (which see request `Headers`, not a full
 * `Request` — hence a sibling to assertCsrf rather than the same function).
 * Rejects explicit cross-site fetches and any Origin whose host ≠ the Host header.
 * Shared by the login and signup actions so the check can't drift between them.
 */
export function assertSameOrigin(h: Headers): boolean {
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") return false;
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isWellFormed(token: string): boolean {
  const [raw, sig] = token.split(".");
  if (!raw || !sig) return false;
  return safeEqual(sig, sign(raw));
}

/**
 * Build a cookie header for server-action -> route-handler forwarding.
 * Any CSRF cookie already in the jar (set at login) must be dropped —
 * duplicated names make readCsrfCookie pick the stale first entry and
 * fail the double-submit check (#29).
 */
export function forwardedCookieHeader(
  jar: ReadonlyArray<{ name: string; value: string }>,
  freshToken: string,
): string {
  // Values come from getAll(), which returns them already
  // percent-decoded; re-encode so a value containing ';' (or '=')
  // can't split the header into bogus name=value pairs.
  const parts = jar
    .filter((c) => c.name !== CSRF_COOKIE_NAME)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`);
  parts.push(`${CSRF_COOKIE_NAME}=${freshToken}`);
  return parts.join("; ");
}

function readCsrfCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export function assertCsrf(req: Request): void {
  // 1) Sec-Fetch-Site (modern browsers) — reject explicit cross-site.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    throw new AppError(403, "Forbidden", "Cross-site request rejected.");
  }

  // 2) Origin must match APP_URL when present (fallback / belt-and-suspenders).
  const origin = req.headers.get("origin");
  if (origin && origin !== env.APP_URL) {
    throw new AppError(403, "Forbidden", "Request origin not allowed.");
  }

  // 3) Double-submit: header token === cookie token, and signature valid.
  const headerToken = req.headers.get("x-csrf-token");
  const cookieToken = readCsrfCookie(req);
  if (
    !headerToken ||
    !cookieToken ||
    !safeEqual(headerToken, cookieToken) ||
    !isWellFormed(headerToken)
  ) {
    throw new AppError(403, "Forbidden", "Invalid CSRF token.");
  }
}

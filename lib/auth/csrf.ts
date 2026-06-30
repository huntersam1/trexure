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

function isWellFormed(token: string): boolean {
  const [raw, sig] = token.split(".");
  if (!raw || !sig) return false;
  return safeEqual(sig, sign(raw));
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

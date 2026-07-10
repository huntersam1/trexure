import { NextResponse, type NextRequest } from "next/server";
import { RECEIVER_SESSION_COOKIE_NAME } from "@/lib/receiver/cookie";

// Public = no session required. Webhooks are HMAC-authed in their handlers.
const PUBLIC_EXACT = new Set(["/login", "/signup", "/api/auth/login", "/api/auth/signup", "/api/health"]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/webhooks/")) return true;
  // Verifiable disclosure links (#128): the no-login auditor page and its
  // on-chain verify action authenticate by the URL token in their own handlers,
  // so the tenant session gate must not block them.
  if (pathname.startsWith("/verify/") || pathname.startsWith("/api/verify/")) return true;
  return false;
}

// Receiver (freelancer) area (P3, #85) — gated by the RECEIVER session, NOT the
// tenant session, so the two personas stay isolated. `/api/claim` enforces
// receiver auth in its handler (requireReceiver), so middleware just lets it
// reach the handler rather than applying the tenant gate.
const RECEIVER_PUBLIC_EXACT = new Set(["/claim/login", "/claim/register"]);

function isReceiverArea(pathname: string): boolean {
  return (
    pathname === "/claim" ||
    pathname.startsWith("/claim/") ||
    pathname === "/api/claim" ||
    pathname.startsWith("/api/claim/")
  );
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function applySecurityHeaders(res: NextResponse, nonce: string): void {
  const csp = [
    `default-src 'self'`,
    // No inline scripts. Dev-only 'unsafe-eval': React dev mode needs eval()
    // for debugging features; production React never uses it, so prod stays strict.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,                    // styles only; not scripts
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const nonce = makeNonce();
  const cookieName = process.env.SESSION_COOKIE_NAME || "__Host-trexure_session";
  const hasSession = Boolean(req.cookies.get(cookieName)?.value);
  const hasReceiverSession = Boolean(req.cookies.get(RECEIVER_SESSION_COOKIE_NAME)?.value);

  let res: NextResponse;

  if (isReceiverArea(pathname)) {
    // Receiver-gated area. API paths defer to the handler's requireReceiver;
    // the login/register pages are public; every other page needs the receiver
    // session (a tenant `User` session grants nothing here).
    const needsReceiver =
      !pathname.startsWith("/api/") && !RECEIVER_PUBLIC_EXACT.has(pathname);
    if (needsReceiver && !hasReceiverSession) {
      // Preserve the full path + query so an emailed claim link (#81,
      // /claim/access?t=…) survives the login round-trip. Rebuild the query
      // cleanly so the original params (e.g. the token) don't leak onto the
      // login URL alongside `next`.
      const target = pathname + req.nextUrl.search;
      const url = req.nextUrl.clone();
      url.pathname = "/claim/login";
      url.search = "";
      url.searchParams.set("next", target);
      res = NextResponse.redirect(url);
    } else {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-nonce", nonce);
      res = NextResponse.next({ request: { headers: requestHeaders } });
    }
    applySecurityHeaders(res, nonce);
    return res;
  }

  if (!isPublic(pathname) && !hasSession) {
    // Presence gate only — full identity/role validation happens in route handlers
    // / RSC via requireSession / requireAdmin (AGENT §5: no DB in edge middleware).
    if (pathname.startsWith("/api/")) {
      res = NextResponse.json(
        { type: "about:blank", title: "Unauthorized", status: 401, detail: "Authentication required." },
        { status: 401, headers: { "content-type": "application/problem+json" } },
      );
    } else {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      res = NextResponse.redirect(url);
    }
  } else {
    // Forward the nonce so RSC can attach it to any <script>.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }

  applySecurityHeaders(res, nonce);
  return res;
}

export const config = {
  // Run on everything except Next static assets / image optimizer / favicon / public fonts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};

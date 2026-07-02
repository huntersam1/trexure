import { NextResponse, type NextRequest } from "next/server";

// Public = no session required. Webhooks are HMAC-authed in their handlers.
const PUBLIC_EXACT = new Set(["/login", "/signup", "/api/auth/login", "/api/auth/signup", "/api/health"]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/webhooks/")) return true;
  return false;
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

  let res: NextResponse;

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

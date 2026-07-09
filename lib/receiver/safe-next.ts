/**
 * Confine a post-login `next` redirect to the receiver claim area (#81). Guards
 * against open redirects: anything that isn't an internal `/claim…` path (e.g.
 * a protocol-relative `//evil.com`) falls back to `/claim`. Dependency-free so
 * both the login page (server component) and the login server action can share
 * one definition.
 */
export function sanitizeNext(next: string | undefined | null): string {
  if (typeof next !== "string" || next.startsWith("//")) return "/claim";
  if (next === "/claim" || next.startsWith("/claim/") || next.startsWith("/claim?")) return next;
  return "/claim";
}

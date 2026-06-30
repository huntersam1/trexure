import { createHmac, timingSafeEqual } from "node:crypto";

/** Hex HMAC-SHA256 of the exact raw body bytes. */
export function signHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Timing-safe verification of an `x-callback-token`-style signature over the
 * RAW request body. Returns false for any length mismatch or missing input —
 * never throws, so callers can branch cleanly.
 */
export function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(signHmac(rawBody, secret), "utf8");
  const provided = Buffer.from(signature, "utf8");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

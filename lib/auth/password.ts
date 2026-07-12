import "server-only";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP argon2id baseline)
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    // argon2.verify is constant-time and re-derives params from the encoded hash.
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed/empty hash → treat as a failed verification, never throw.
    return false;
  }
}

// Lazily-computed dummy hash so an unknown username still pays the argon2 verify
// cost — no login-timing user-enumeration oracle (#143). Shared by the login
// API route and the login server action.
let dummyHashPromise: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

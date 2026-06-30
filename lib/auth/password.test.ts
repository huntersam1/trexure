import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password", () => {
  it("hashes to an argon2id encoded string distinct from the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword(hash, "s3cret-pass")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword(hash, "wrong-pass")).toBe(false);
  });

  it("returns false (no throw) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });
});

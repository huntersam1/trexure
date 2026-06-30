import { describe, it, expect } from "vitest";
import { loginSchema } from "@/lib/validation/auth";

describe("loginSchema", () => {
  it("accepts a valid username/password", () => {
    const r = loginSchema.safeParse({ username: "admin", password: "hunter2hunter2" });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys (.strict)", () => {
    const r = loginSchema.safeParse({ username: "admin", password: "x", role: "ADMIN" });
    expect(r.success).toBe(false);
  });

  it("rejects empty fields", () => {
    expect(loginSchema.safeParse({ username: "", password: "" }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(loginSchema.safeParse({ username: "admin" }).success).toBe(false);
  });
});

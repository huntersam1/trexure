import { describe, it, expect } from "vitest";
import { createUserSchema } from "../../lib/validation/admin";

describe("createUserSchema", () => {
  it("accepts a valid payload", () => {
    const r = createUserSchema.safeParse({ username: "alice", password: "correct-horse-battery", role: "MEMBER", tenantId: "ckv1tenantid000000000000" });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys (.strict)", () => {
    const r = createUserSchema.safeParse({ username: "alice", password: "correct-horse-battery", role: "MEMBER", tenantId: "ckv1tenantid000000000000", isSuperuser: true });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid role and a short password", () => {
    expect(createUserSchema.safeParse({ username: "a", password: "short", role: "ROOT", tenantId: "x" }).success).toBe(false);
  });
});

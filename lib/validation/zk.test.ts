import { describe, it, expect } from "vitest";
import { decryptSchema } from "@/lib/validation/zk";

describe("decryptSchema", () => {
  it("accepts a valid payment id", () => {
    expect(decryptSchema.parse({ id: "pay_abc123" })).toEqual({ id: "pay_abc123" });
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => decryptSchema.parse({ id: "pay_abc123", viewKey: "leak" })).toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => decryptSchema.parse({ id: "" })).toThrow();
  });
});

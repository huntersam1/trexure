import { describe, it, expect } from "vitest";
import { problem, AppError } from "@/lib/http/problem";

describe("problem()", () => {
  it("returns an application/problem+json Response with RFC-9457 fields", async () => {
    const res = problem(404, "Not Found", "no such payment");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "no such payment",
    });
  });

  it("uses a custom type URI when provided", async () => {
    const res = problem(429, "Too Many Requests", undefined, "https://trexure.dev/errors/rate-limited");
    const body = await res.json();
    expect(body.type).toBe("https://trexure.dev/errors/rate-limited");
    expect(body.detail).toBeUndefined();
  });
});

describe("AppError", () => {
  it("carries status/title/detail and is an Error", () => {
    const e = new AppError(403, "Forbidden", "csrf failed");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(403);
    expect(e.title).toBe("Forbidden");
    expect(e.detail).toBe("csrf failed");
  });
});

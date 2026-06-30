import "server-only";
import { ZodError } from "zod";
import { problem, AppError } from "@/lib/http/problem";

/** Map a thrown value to an RFC-9457 problem+json Response. Never leaks internals. */
export function problemFromError(e: unknown): Response {
  if (e instanceof AppError) {
    return problem(e.status, e.title, e.detail);
  }
  if (e instanceof ZodError) {
    const detail = e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return problem(400, "Invalid request", detail);
  }
  return problem(500, "Internal Server Error");
}

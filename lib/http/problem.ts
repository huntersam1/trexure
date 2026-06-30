/**
 * RFC-9457 "problem+json" helpers. Shared by route handlers and the worker.
 * NOTE: pure module (no `server-only`) so it can be unit-tested in node and
 * imported by both runtimes. It never serializes secrets or stack traces.
 */

export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export function problem(
  status: number,
  title: string,
  detail?: string,
  type = "about:blank",
): Response {
  const body: ProblemDocument = { type, title, status };
  if (detail !== undefined) body.detail = detail;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

export class AppError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;

  constructor(status: number, title: string, detail?: string) {
    super(detail ?? title);
    this.name = "AppError";
    this.status = status;
    this.title = title;
    this.detail = detail;
  }

  /** Convert this error into a problem+json Response. */
  toResponse(): Response {
    return problem(this.status, this.title, this.detail);
  }
}

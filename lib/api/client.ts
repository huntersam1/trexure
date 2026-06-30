export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, title: string, detail?: string) {
    super(title);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { title?: string; detail?: string };
    return new ApiError(res.status, body.title ?? "Request failed", body.detail);
  } catch {
    return new ApiError(res.status, "Request failed");
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, csrfToken: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

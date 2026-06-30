import "server-only";
import { resolveApiKey } from "@/lib/auth/api-key";
import { AppError } from "@/lib/http/problem";

/**
 * Authenticate a programmatic request by its `Authorization: Bearer <key>` header.
 * Returns the tenant scope or throws AppError(401). Use for API-key-accessible routes.
 */
export async function requireApiKey(req: Request): Promise<{ tenantId: string }> {
  const header = req.headers.get("authorization");
  if (!header) {
    throw new AppError(401, "Missing API key", "Provide an Authorization: Bearer <key> header.");
  }
  const resolved = await resolveApiKey(header);
  if (!resolved) {
    throw new AppError(401, "Invalid API key", "The API key is unknown or has been revoked.");
  }
  return resolved;
}

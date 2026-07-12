import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../lib/http/problem";

const { requirePlatformAdmin, assertCsrf, hashPassword, create, recordAudit } = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  assertCsrf: vi.fn(),
  hashPassword: vi.fn(),
  create: vi.fn(),
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/auth/session", () => ({ requirePlatformAdmin }));
vi.mock("../../lib/auth/csrf", () => ({ assertCsrf }));
vi.mock("../../lib/auth/password", () => ({ hashPassword }));
vi.mock("../../lib/db", () => ({ prisma: { user: { create } } }));
vi.mock("../../lib/audit/log", () => ({ recordAudit }));

import { POST } from "../../app/api/admin/users/route";

function req(body: unknown) {
  return new Request("https://app.test/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.test" },
    body: JSON.stringify(body),
  });
}
const valid = { username: "bob", password: "correct-horse-battery", role: "MEMBER", tenantId: "ckv1tenantid000000000000" };

describe("POST /api/admin/users", () => {
  beforeEach(() => {
    requirePlatformAdmin.mockReset().mockResolvedValue({ id: "u_admin", role: "ADMIN", isPlatformAdmin: true });
    assertCsrf.mockReset();
    hashPassword.mockReset().mockResolvedValue("$argon2id$v=19$m=...$hash");
    create.mockReset().mockResolvedValue({ id: "u_new", username: "bob", role: "MEMBER", tenantId: valid.tenantId, passwordHash: "$argon2id$..." });
    recordAudit.mockClear();
  });

  it("hashes the password with argon2id and never stores plaintext", async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(201);
    expect(hashPassword).toHaveBeenCalledWith("correct-horse-battery");
    const data = create.mock.calls[0]![0].data;
    expect(data.passwordHash).toBe("$argon2id$v=19$m=...$hash");
    expect(JSON.stringify(data)).not.toContain("correct-horse-battery");
    expect(data).not.toHaveProperty("password");
  });

  it("never leaks passwordHash in the response body", async () => {
    const res = await POST(req(valid));
    const body = await res.json();
    expect(body.user).toMatchObject({ id: "u_new", username: "bob", role: "MEMBER", tenantId: valid.tenantId });
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("rejects unknown keys with 422 and does not create", async () => {
    const res = await POST(req({ ...valid, isSuperuser: true }));
    expect(res.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-platform-admin (C1: a tenant ADMIN cannot create users)", async () => {
    requirePlatformAdmin.mockRejectedValue(new AppError(403, "Forbidden", "Platform administrator access required."));
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 403 when CSRF assertion fails", async () => {
    assertCsrf.mockImplementation(() => { throw new AppError(403, "CSRF"); });
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// --- Fake cookie jar backing next/headers ---
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

vi.mock("@/lib/env", () => ({ env: { SESSION_COOKIE_NAME: "__Host-trexure_session" } }));

// --- In-memory prisma.session + user join ---
type Row = { id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date };
const sessions: Row[] = [];
const users = [{ id: "u1", username: "admin", role: "ADMIN" as const, tenantId: "t1", isPlatformAdmin: false }];
vi.mock("@/lib/db", () => ({
  prisma: {
    session: {
      create: async ({ data }: any) => {
        const row = { id: `s${sessions.length + 1}`, createdAt: new Date(), ...data };
        sessions.push(row);
        return row;
      },
      findUnique: async ({ where, include }: any) => {
        const row = sessions.find((s) => s.tokenHash === where.tokenHash);
        if (!row) return null;
        const user = users.find((u) => u.id === row.userId)!;
        return include?.user ? { ...row, user } : row;
      },
      update: async ({ where, data }: any) => {
        const row = sessions.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        const i = sessions.findIndex((s) => s.id === where.id);
        if (i >= 0) sessions.splice(i, 1);
        return {};
      },
      deleteMany: async ({ where }: any) => {
        for (let i = sessions.length - 1; i >= 0; i--) {
          if (sessions[i]!.tokenHash === where.tokenHash) sessions.splice(i, 1);
        }
        return { count: 1 };
      },
    },
  },
}));

import { createSession, getSessionUser, destroySession, requireSession, requireAdmin, requirePlatformAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/http/problem";

const COOKIE = "__Host-trexure_session";

beforeEach(() => {
  jar.clear();
  sessions.length = 0;
});

describe("session", () => {
  it("creates a session: sets cookie and stores only the token hash", async () => {
    await createSession("u1", "1.2.3.4", "vitest");
    const token = jar.get(COOKIE)!;
    expect(token).toBeTruthy();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(sessions[0]!.tokenHash).not.toBe(token);
  });

  it("validates a live session and returns the joined user", async () => {
    await createSession("u1");
    const user = await getSessionUser();
    expect(user).toEqual({ id: "u1", username: "admin", role: "ADMIN", tenantId: "t1", isPlatformAdmin: false });
  });

  it("rejects an expired session and removes the row", async () => {
    await createSession("u1");
    sessions[0]!.expiresAt = new Date(Date.now() - 1000);
    expect(await getSessionUser()).toBeNull();
    expect(sessions).toHaveLength(0);
  });

  it("destroys the session: deletes the row and clears the cookie", async () => {
    await createSession("u1");
    await destroySession();
    expect(sessions).toHaveLength(0);
    expect(jar.get(COOKIE)).toBeUndefined();
  });

  it("requireSession throws AppError(401) when no cookie is present", async () => {
    await expect(requireSession()).rejects.toMatchObject({ status: 401 });
    await expect(requireSession()).rejects.toBeInstanceOf(AppError);
  });

  it("requireAdmin returns ADMIN users and 403s non-admins", async () => {
    await createSession("u1");
    expect((await requireAdmin()).role).toBe("ADMIN");
    users[0]!.role = "MEMBER" as any;
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    users[0]!.role = "ADMIN" as any;
  });

  it("requirePlatformAdmin 403s a tenant ADMIN and allows only platform admins (#143 C1)", async () => {
    await createSession("u1");
    // A self-signup tenant ADMIN (role ADMIN, isPlatformAdmin false) must NOT
    // pass the platform gate — this is the core C1 fix.
    await expect(requirePlatformAdmin()).rejects.toMatchObject({ status: 403 });
    users[0]!.isPlatformAdmin = true;
    expect((await requirePlatformAdmin()).isPlatformAdmin).toBe(true);
    users[0]!.isPlatformAdmin = false;
  });
});

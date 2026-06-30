import { requireAdmin } from "../../../../lib/auth/session";
import { assertCsrf } from "../../../../lib/auth/csrf";
import { hashPassword } from "../../../../lib/auth/password";
import { prisma } from "../../../../lib/db";
import { createUserSchema } from "../../../../lib/validation/admin";
import { recordAudit } from "../../../../lib/audit/log";
import { AppError, problem } from "../../../../lib/http/problem";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();
    assertCsrf(req);

    const json = await req.json().catch(() => null);
    const parsed = createUserSchema.safeParse(json);
    if (!parsed.success) {
      return problem(422, "Invalid request", "One or more fields are invalid.");
    }
    const { username, password, role, tenantId } = parsed.data;

    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: { username, passwordHash, role, tenantId },
      select: { id: true, username: true, role: true, tenantId: true },
    });
    // Explicitly project only safe fields — never echo passwordHash, regardless
    // of the row shape returned.
    const user = { id: created.id, username: created.username, role: created.role, tenantId: created.tenantId };

    await recordAudit({
      action: "admin.user.create",
      userId: admin.id,
      tenantId,
      target: user.id,
      metadata: { username, role },
    });

    return Response.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    // Unique-constraint (duplicate username) and FK (bad tenantId) surface generically.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return problem(409, "Conflict", "A user with that username already exists.");
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2003") {
      return problem(422, "Invalid request", "Unknown tenant.");
    }
    return problem(500, "Internal Server Error");
  }
}

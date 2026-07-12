import { requirePlatformAdmin } from "../../../../lib/auth/session";
import { AppError, problem } from "../../../../lib/http/problem";
import { listTenantsWithCounts } from "../../../../lib/admin/queries";
import { recordAudit } from "../../../../lib/audit/log";

export const dynamic = "force-dynamic";

export async function GET(_req: Request): Promise<Response> {
  try {
    const admin = await requirePlatformAdmin();
    const tenants = await listTenantsWithCounts();
    await recordAudit({ action: "admin.tenants.list", userId: admin.id, metadata: { count: tenants.length } });
    return Response.json({
      tenants: tenants.map((t) => ({ id: t.id, name: t.name, userCount: t.userCount, createdAt: t.createdAt.toISOString() })),
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    return problem(500, "Internal Server Error");
  }
}

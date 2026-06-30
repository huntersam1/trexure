import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { forTenant, prisma } from "@/lib/db";
import { AppError } from "@/lib/http/problem";
import { problemFromError } from "@/lib/http/respond";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireSession();
    assertCsrf(req);
    const { id } = await params;

    const db = forTenant(user.tenantId);
    // findFirst (not findUnique) so the tenant extension can inject tenantId.
    const existing = await db.apiKey.findFirst({ where: { id } });
    if (!existing) {
      throw new AppError(404, "API key not found");
    }

    await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: "apikey.revoke",
        target: id,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return problemFromError(e);
  }
}

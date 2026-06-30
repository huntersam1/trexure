import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { forTenant, prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/auth/api-key";
import { createApiKeySchema } from "@/lib/validation/keys";
import { problemFromError } from "@/lib/http/respond";
import type { Prisma } from "@/lib/generated/prisma/client";

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireSession();
    assertCsrf(req);

    const input = createApiKeySchema.parse(await req.json());
    const { plaintext, keyHash } = generateApiKey();

    const db = forTenant(user.tenantId);
    // forTenant's extension injects tenantId into create data at runtime; the
    // static type still requires it, so assert the tenant-scoped input shape.
    const key = await db.apiKey.create({
      data: { name: input.name, keyHash } as unknown as Prisma.ApiKeyUncheckedCreateInput,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: "apikey.create",
        target: key.id,
      },
    });

    // plaintext is returned exactly once and never persisted.
    return NextResponse.json(
      { id: key.id, name: key.name, plaintext, createdAt: key.createdAt },
      { status: 201 },
    );
  } catch (e) {
    return problemFromError(e);
  }
}

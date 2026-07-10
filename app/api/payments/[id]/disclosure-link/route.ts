import "server-only";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { createDisclosureLink, revokeDisclosureLink } from "@/lib/reports/disclosure-link";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mint a verifiable disclosure link for a settled payment (#128). ADMIN only —
 * this exposes payment facts to an unauthenticated auditor URL, so it's the most
 * sensitive share action in the app. The raw token is returned exactly ONCE.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const { id } = await ctx.params;

    const minted = await createDisclosureLink(session.tenantId, id, session.id);
    return NextResponse.json(minted, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "mint disclosure link failed");
    return problem(500, "Mint failed", "Could not create the disclosure link");
  }
}

/** Revoke the payment's active disclosure link. ADMIN only. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    assertCsrf(req);
    const { id } = await ctx.params;

    const revoked = await revokeDisclosureLink(session.tenantId, id, session.id);
    return NextResponse.json({ revoked }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "revoke disclosure link failed");
    return problem(500, "Revoke failed", "Could not revoke the disclosure link");
  }
}

import "server-only";

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { enforceRateLimit } from "@/lib/auth/rate-limit";
import { forTenant } from "@/lib/db";
import { loadViewKey } from "@/lib/crypto/viewkey";
import { decryptWithViewKey } from "@/lib/zk";
import { decryptSchema } from "@/lib/validation/zk";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(); // 401 if absent; carries tenantId
    assertCsrf(req); // Origin/Sec-Fetch-Site + double-submit token; 403 on failure
    // View-key AES decrypt (audited) — throttle per tenant (#143).
    const limited = await enforceRateLimit(`decrypt:${session.tenantId}`, { limit: 30, windowSec: 60 });
    if (limited) return limited;

    const { id } = decryptSchema.parse(await ctx.params);
    const db = forTenant(session.tenantId); // tenant-scoped: other tenants' rows are invisible

    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) throw new AppError(404, "Not found", "Payment not found");
    if (!payment.encryptedPayload || !payment.payloadNonce) {
      throw new AppError(409, "Not shielded", "Payment has no shielded payload to decrypt");
    }

    const viewKey = await loadViewKey(session.tenantId); // server-side AES decrypt
    if (!viewKey) throw new AppError(409, "No view key", "Tenant has no view key configured");

    let payload: Record<string, unknown>;
    try {
      payload = await decryptWithViewKey(
        viewKey,
        Buffer.from(payment.encryptedPayload),
        Buffer.from(payment.payloadNonce),
      );
    } finally {
      viewKey.fill(0); // zeroize — the view key is never returned, never logged
    }

    await db.auditLog.create({
      data: {
        userId: session.id,
        action: "viewkey.decrypt",
        target: id,
        ip: req.headers.get("x-forwarded-for") ?? undefined,
      },
    });

    // Response carries the decrypted payload ONLY — never the view key.
    return NextResponse.json({
      payload,
      proofHash: payment.proofHash,
      privacy: { shielded: payment.shielded, viewKeyDisclosed: false },
    });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "payment decrypt failed"); // err only; viewKey is redacted/never attached
    return problem(500, "Internal Server Error");
  }
}

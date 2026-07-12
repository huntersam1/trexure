import "server-only";

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/auth/csrf";
import { enforceRateLimit } from "@/lib/auth/rate-limit";
import { forTenant } from "@/lib/db";
import { loadViewKey } from "@/lib/crypto/viewkey";
import { verifyPaymentProofOnChain } from "@/lib/zk/groth16";
import { problem, AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs"; // snarkjs prover + Soroban RPC
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    assertCsrf(req);
    // Groth16 prover + Soroban RPC per call — throttle per tenant (#143).
    const limited = await enforceRateLimit(`verify-proof:${session.tenantId}`, { limit: 15, windowSec: 60 });
    if (limited) return limited;

    const { id } = await ctx.params;
    const db = forTenant(session.tenantId);

    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) throw new AppError(404, "Not found", "Payment not found");

    const viewKey = await loadViewKey(session.tenantId);
    if (!viewKey) throw new AppError(409, "No view key", "Tenant has no view key configured");

    let result;
    try {
      // Generate a REAL Groth16 proof for this payment and verify it ON-CHAIN
      // (Soroban testnet). The view key never leaves the server.
      result = await verifyPaymentProofOnChain(viewKey, payment.intentId);
    } finally {
      viewKey.fill(0);
    }

    await db.auditLog.create({
      data: {
        userId: session.id,
        action: "zk.verify_proof",
        target: id,
        ip: req.headers.get("x-forwarded-for") ?? undefined,
      },
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return problem(err.status, err.title, err.detail);
    logger.error({ err }, "zk verify-proof failed");
    return problem(502, "Verification failed", "Could not verify the proof on-chain");
  }
}

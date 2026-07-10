import "server-only";

import { NextResponse } from "next/server";

import { verifyDisclosureOnChain } from "@/lib/reports/disclosure-link";
import { rateLimit } from "@/lib/auth/rate-limit";
import { problem } from "@/lib/http/problem";
import { logger } from "@/lib/log";

export const runtime = "nodejs"; // snarkjs prover + Soroban RPC
export const dynamic = "force-dynamic";

/**
 * Public on-chain verification for a disclosure link (#128). No session — the
 * URL token is the credential. Heavy (real Groth16 + Soroban RPC), so it's
 * rate-limited per IP. Unknown/expired/revoked tokens return 404 with no detail
 * (uniform with the page's invalid state; no enumeration).
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const gate = await rateLimit(`disclosure-verify:${ip}`, { limit: 10, windowSec: 60 });
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ type: "about:blank", title: "Too Many Requests", status: 429, detail: "Please wait before verifying again." }),
        {
          status: 429,
          headers: {
            "content-type": "application/problem+json",
            "Retry-After": String(gate.retryAfterSec),
          },
        },
      );
    }

    const { token } = await ctx.params;
    const result = await verifyDisclosureOnChain(token);
    if (!result) return problem(404, "Not found", "This verification link is no longer valid.");

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error({ err }, "public disclosure verify failed");
    return problem(502, "Verification failed", "Could not verify the proof on-chain.");
  }
}

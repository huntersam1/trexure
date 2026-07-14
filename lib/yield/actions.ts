"use server";
import "server-only";

import { requireAdmin } from "../auth/session";
import { recordAudit } from "../audit/log";
import { AppError } from "../http/problem";
import { saveYieldConfig } from "./config";

/**
 * Treasury Float Yield (#161 P5) — settings server action. ADMIN-gated; tenantId
 * always comes from the session, never the form. Validation (non-negative amounts,
 * feeBps 0–10000) lives in `saveYieldConfig`, which throws AppError(422).
 */

export type YieldActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveYieldConfigAction(
  _prev: YieldActionResult | null,
  formData: FormData,
): Promise<YieldActionResult> {
  try {
    const user = await requireAdmin();

    const config = await saveYieldConfig(user.tenantId, {
      enabled: formData.get("enabled") === "on",
      minIdleBuffer: String(formData.get("minIdleBuffer") ?? "0"),
      sweepThreshold: String(formData.get("sweepThreshold") ?? "0"),
      feeBps: String(formData.get("feeBps") ?? "0"),
    });

    await recordAudit({
      action: "yield.config.update",
      tenantId: user.tenantId,
      userId: user.id,
      metadata: {
        enabled: config.enabled,
        minIdleBuffer: config.minIdleBuffer,
        sweepThreshold: config.sweepThreshold,
        feeBps: config.feeBps,
      },
    });

    return { ok: true, message: config.enabled ? "Treasury yield enabled." : "Treasury yield settings saved." };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.detail ?? e.title };
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

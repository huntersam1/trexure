"use server";
import "server-only";
import { randomBytes } from "node:crypto";
import { requireSession } from "../auth/session";
import { forTenant } from "../db";
import { aesEncrypt } from "../crypto/aes";
import { storeViewKey } from "../crypto/viewkey";
import { viewKeySchema, anchorConfigSchema } from "../validation/settings";
import { recordAudit } from "../audit/log";
import { AppError } from "../http/problem";
import type { Prisma } from "../generated/prisma/client";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: true; message: string; revealOnce: string }
  | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  if (e instanceof AppError) return { ok: false, error: e.title };
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Stores a tenant view key write-only. tenantId comes from the session, never the form. */
export async function saveViewKeyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireSession();
    const parsed = viewKeySchema.safeParse({ viewKey: formData.get("viewKey") });
    if (!parsed.success) return { ok: false, error: "View key must be 16–512 characters." };

    // storeViewKey takes a Buffer; the form provides text, stored as its UTF-8 bytes.
    await storeViewKey(user.tenantId, Buffer.from(parsed.data.viewKey, "utf8"));
    await recordAudit({ action: "viewkey.update", tenantId: user.tenantId, userId: user.id, target: user.tenantId });
    return { ok: true, message: "View key updated." };
  } catch (e) {
    return fail(e);
  }
}

/** Stores anchor provider + encrypted webhook secret (nonce-prefixed Bytes), session-scoped. */
export async function saveAnchorConfigAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireSession();
    const parsed = anchorConfigSchema.safeParse({
      provider: formData.get("provider"),
      webhookSecret: formData.get("webhookSecret"),
    });
    if (!parsed.success) return { ok: false, error: "Provider and webhook secret are required." };

    const { ciphertext, nonce } = aesEncrypt(Buffer.from(parsed.data.webhookSecret));
    const stored = Buffer.concat([nonce, ciphertext]);

    const db = forTenant(user.tenantId);
    const existing = await db.anchorConfig.findFirst({ select: { id: true } });
    await db.anchorConfig.upsert({
      where: { id: existing?.id ?? "__none__" },
      // forTenant injects tenantId; Bytes (`stored`) is a Node Buffer — assert the
      // tenant-scoped input shapes (runtime values are unchanged).
      create: { tenantId: user.tenantId, provider: parsed.data.provider, webhookSecret: stored, config: {} } as unknown as Prisma.AnchorConfigUncheckedCreateInput,
      update: { provider: parsed.data.provider, webhookSecret: stored } as unknown as Prisma.AnchorConfigUncheckedUpdateInput,
    });

    await recordAudit({ action: "anchor.config.update", tenantId: user.tenantId, userId: user.id, metadata: { provider: parsed.data.provider } });
    return { ok: true, message: "Anchor configuration saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Rotates the anchor webhook secret, persisting the new value encrypted and revealing it ONCE. */
export async function rotateWebhookSecretAction(_prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireSession();
    const newSecret = randomBytes(32).toString("hex");
    const { ciphertext, nonce } = aesEncrypt(Buffer.from(newSecret));
    const stored = Buffer.concat([nonce, ciphertext]);

    const db = forTenant(user.tenantId);
    const existing = await db.anchorConfig.findFirst({ select: { id: true, provider: true } });
    if (!existing) return { ok: false, error: "Configure an anchor before rotating its secret." };

    await db.anchorConfig.update({
      where: { id: existing.id },
      data: { webhookSecret: stored } as unknown as Prisma.AnchorConfigUncheckedUpdateInput,
    });
    await recordAudit({ action: "anchor.secret.rotate", tenantId: user.tenantId, userId: user.id, target: existing.id });

    return { ok: true, message: "Webhook secret rotated. Copy it now — it will not be shown again.", revealOnce: newSecret };
  } catch (e) {
    return fail(e);
  }
}

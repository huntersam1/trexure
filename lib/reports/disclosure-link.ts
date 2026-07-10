import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { prisma, forTenant } from "../db";
import { env } from "../env";
import { loadViewKey } from "../crypto/viewkey";
import { verifyPaymentProofOnChain, type PaymentProofResult } from "../zk/groth16";
import { buildAttestation, type Attestation } from "./attestation";

/**
 * Verifiable disclosure links (#128). Builds on R2 (#101) / R4 (#103): an ADMIN
 * mints a tokenized, no-login share link for ONE settled payment; an outside
 * auditor opens `/verify/<token>` and sees only that payment's attestation and
 * can re-verify it on-chain.
 *
 * Security model mirrors the emailed claim link (`lib/receiver/claim-link.ts`):
 * the raw token lives only in the shared URL — we persist just `sha256(token)`
 * for lookup, so a DB read alone can't reconstruct a working link. Links expire
 * and are revocable; expired/revoked/unknown tokens all render an identical
 * `invalid` result (no data, no enumeration). Every mint, view, verify, and
 * revoke is audit-logged, so the disclosure is itself auditable.
 */

const LINK_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** `${APP_URL}/verify/<token>` — the shareable auditor URL. */
export function buildVerifyUrl(token: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/verify/${token}`;
}

export type MintedLink = { token: string; url: string; expiresAt: string };

/**
 * Mint (or rotate) the disclosure link for a settled payment and return the raw
 * token ONCE. `buildAttestation` enforces tenant ownership (404) and SETTLED
 * status (409) before we mint, so only shareable payments get a link. Re-issuing
 * rotates the token via the `@@unique(paymentId)`, invalidating the old URL.
 */
export async function createDisclosureLink(
  tenantId: string,
  paymentId: string,
  userId: string,
  now: Date = new Date(),
): Promise<MintedLink> {
  // Throws AppError(404/409) if the payment isn't this tenant's or isn't settled.
  await buildAttestation(tenantId, paymentId, now);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  const data = {
    tenantId,
    tokenHash: hashToken(token),
    createdByUserId: userId,
    expiresAt,
    revokedAt: null,
    viewCount: 0,
    lastViewedAt: null,
  };
  await prisma.disclosureLink.upsert({
    where: { paymentId },
    create: { paymentId, ...data },
    update: data,
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: "disclosure.link.issued",
      target: paymentId,
      metadata: { expiresAt: expiresAt.toISOString() },
    },
  });

  return { token, url: buildVerifyUrl(token), expiresAt: expiresAt.toISOString() };
}

/** Look up an active link by raw token. Returns null for unknown/expired/revoked. */
async function activeLink(token: string, now: Date) {
  if (!token) return null;
  const link = await prisma.disclosureLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, tenantId: true, paymentId: true, expiresAt: true, revokedAt: true, createdByUserId: true },
  });
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt.getTime() <= now.getTime()) return null;
  return link;
}

export type ResolvedDisclosure =
  | { status: "ok"; attestation: Attestation; linkId: string }
  | { status: "invalid" };

/**
 * Resolve a public token to its attestation. No session required — this is the
 * no-login auditor path. Records the view (count + audit row) on success and
 * fails closed to `invalid` for any unknown/expired/revoked token OR a payment
 * that is no longer disclosable.
 */
export async function resolveDisclosureLink(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedDisclosure> {
  const link = await activeLink(token, now);
  if (!link) return { status: "invalid" };

  let attestation: Attestation;
  try {
    attestation = await buildAttestation(link.tenantId, link.paymentId, now);
  } catch {
    return { status: "invalid" }; // payment no longer settled / removed — fail closed
  }

  await prisma.disclosureLink.update({
    where: { id: link.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: now },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: link.tenantId,
      userId: link.createdByUserId,
      action: "disclosure.link.viewed",
      target: link.paymentId,
      metadata: { linkId: link.id },
    },
  });

  return { status: "ok", attestation, linkId: link.id };
}

/**
 * Re-verify the linked payment's proof on-chain (Soroban testnet) for a public
 * token. Loads the tenant view key server-side, uses it, and zeroizes it — the
 * key never leaves the server. Returns null for an invalid token.
 */
export async function verifyDisclosureOnChain(
  token: string,
  now: Date = new Date(),
): Promise<PaymentProofResult | null> {
  const link = await activeLink(token, now);
  if (!link) return null;

  const payment = await prisma.payment.findUnique({
    where: { id: link.paymentId },
    select: { intentId: true },
  });
  if (!payment) return null;

  const viewKey = await loadViewKey(link.tenantId);
  if (!viewKey) return null;

  let result: PaymentProofResult;
  try {
    result = await verifyPaymentProofOnChain(viewKey, payment.intentId);
  } finally {
    viewKey.fill(0);
  }

  await prisma.auditLog.create({
    data: {
      tenantId: link.tenantId,
      userId: link.createdByUserId,
      action: "disclosure.link.verified",
      target: link.paymentId,
      metadata: { linkId: link.id, verified: result.verified },
    },
  });

  return result;
}

/** Revoke the payment's active link (ADMIN, tenant-scoped). Returns whether one was revoked. */
export async function revokeDisclosureLink(
  tenantId: string,
  paymentId: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const db = forTenant(tenantId);
  const res = await db.disclosureLink.updateMany({
    where: { paymentId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (res.count === 0) return false;

  await prisma.auditLog.create({
    data: { tenantId, userId, action: "disclosure.link.revoked", target: paymentId },
  });
  return true;
}

import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";
import { getEmailProvider } from "@/lib/email/provider";
import { buildClaimEmail } from "@/lib/email/templates";

/**
 * Emailed claim links (#81, follow-up to batch epic #80). For an off-platform
 * receiver, the batch send emails a signed one-time link — never the raw note.
 *
 * The note is stored encrypted under a key DERIVED FROM the raw link token; the
 * token lives only in the email (we persist just its sha256 for lookup), so a DB
 * read alone can't recover the note. Reveal is gated twice: the caller must hold
 * the token (from the email) AND be an authenticated receiver (the page calls
 * `requireReceiver` before `revealClaimLink`).
 */

const LINK_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const KEY_CONTEXT = "trexure-claimlink-v1:";
const TAG_LEN = 16;

const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => b as unknown as Uint8Array<ArrayBuffer>;
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const deriveKey = (token: string): Buffer => createHash("sha256").update(KEY_CONTEXT + token).digest();

function gcmEncrypt(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Buffer.concat([enc, cipher.getAuthTag()]), nonce };
}

function gcmDecrypt(ciphertext: Buffer, nonce: Buffer, key: Buffer): Buffer {
  const enc = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/** `${APP_URL}/claim/access?t=<token>` — the CTA target in the email. */
export function buildClaimAccessUrl(token: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/claim/access?t=${token}`;
}

/**
 * Create (or refresh) the claim link for a disbursement and return the raw
 * token. Idempotent per payment via the `@@unique([paymentId])` — a re-send
 * rotates the token (old email links stop working, which is the safer default).
 */
export async function createClaimLink(paymentId: string, note: string, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { ciphertext, nonce } = gcmEncrypt(Buffer.from(note, "utf8"), deriveKey(token));
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  const data = {
    tokenHash: hashToken(token),
    encryptedNote: asBytes(ciphertext),
    noteNonce: asBytes(nonce),
    email,
    expiresAt,
    sentAt: null,
    providerRef: null,
    revealedAt: null,
  };
  await prisma.claimLink.upsert({
    where: { paymentId },
    create: { paymentId, ...data },
    update: data,
  });
  return token;
}

export type RevealedClaim = {
  note: string;
  payment: { id: string; sourceAmount: string; sourceAsset: string; status: string; payerName: string };
};

/**
 * Reveal the note behind a claim link. Returns null when the token is unknown,
 * expired, or fails authenticated decryption (tampered ciphertext). The CALLER
 * must have already authenticated the receiver — this function does not itself
 * check the session (the access page gates it with `requireReceiver`).
 */
export async function revealClaimLink(token: string): Promise<RevealedClaim | null> {
  if (!token) return null;
  const link = await prisma.claimLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      encryptedNote: true,
      noteNonce: true,
      expiresAt: true,
      payment: {
        select: {
          id: true,
          sourceAmount: true,
          sourceAsset: true,
          status: true,
          tenant: { select: { name: true } },
        },
      },
    },
  });
  if (!link) return null;
  if (link.expiresAt.getTime() <= Date.now()) return null;

  let note: string;
  try {
    note = gcmDecrypt(Buffer.from(link.encryptedNote), Buffer.from(link.noteNonce), deriveKey(token)).toString("utf8");
  } catch {
    return null; // tampered ciphertext / wrong key — fail closed
  }

  await prisma.claimLink.updateMany({
    where: { tokenHash: hashToken(token), revealedAt: null },
    data: { revealedAt: new Date() },
  });

  return {
    note,
    payment: {
      id: link.payment.id,
      sourceAmount: link.payment.sourceAmount.toString(),
      sourceAsset: link.payment.sourceAsset,
      status: link.payment.status,
      payerName: link.payment.tenant.name,
    },
  };
}

/**
 * Email a receiver their claim link (#81). Creates the link, sends via the
 * configured provider, and records send status. Never throws — a delivery
 * failure returns false so the batch's disbursement still succeeds.
 */
export async function emailClaimLink(args: {
  paymentId: string;
  note: string;
  email: string;
  payerName: string;
  amount: string;
  asset: string;
}): Promise<boolean> {
  try {
    const token = await createClaimLink(args.paymentId, args.note, args.email);
    const msg = buildClaimEmail({
      to: args.email,
      payerName: args.payerName,
      amount: args.amount,
      asset: args.asset,
      claimUrl: buildClaimAccessUrl(token),
    });
    const res = await getEmailProvider().send(msg);
    await prisma.claimLink.update({
      where: { paymentId: args.paymentId },
      data: { sentAt: new Date(), providerRef: res.id },
    });
    return true;
  } catch (err) {
    logger.warn({ err, paymentId: args.paymentId }, "claim email send failed");
    return false;
  }
}

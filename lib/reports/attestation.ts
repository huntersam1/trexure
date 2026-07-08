import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { forTenant } from "../db";
import { env } from "../env";
import { AppError } from "../http/problem";
import { renderReportPdf, type ReportDoc } from "./pdf";

/**
 * Proof-of-Payment Attestation (R4). A single shareable, tamper-evident document
 * a company sends a vendor (or keeps for its records) as evidence that ONE
 * specific payment happened and settled — without exposing the rest of the
 * ledger. Think "signed proof of payment", not the full R2 disclosure pack.
 *
 * Assembled entirely from the already-stored `Receipt.json` + settlement legs
 * (both the fiat `buildReceipt` and on-chain-only `pool-wallet` shapes), so it
 * never re-derives figures. Only issued for a SETTLED payment the tenant owns.
 *
 * Verifiability is twofold:
 *  - **Third-party** — the on-chain tx hash + `proofHash` with a stellar.expert
 *    link anyone can independently confirm on-chain.
 *  - **Issuer tamper-evidence** — an HMAC-SHA256 over the immutable payment facts,
 *    keyed by a signing key derived from `MASTER_ENCRYPTION_KEY` (domain-separated
 *    so the raw master key is never used directly). A full *public* asymmetric
 *    signature is intentionally out of scope for this release (noted on the doc).
 */

const EXPLORER_TX = (txHash: string): string =>
  txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : "";

const SIG_NOTE =
  "Issuer HMAC-SHA256 over the payment facts (tamper-evidence for the issuer's records). " +
  "Independent verification: confirm the on-chain transaction at the stellar.expert link above. " +
  "A public asymmetric signature is out of scope for this release.";

export type AttestationLeg = { legType: string; status: string; txHash: string; bankRef: string };

export type Attestation = {
  paymentId: string;
  tenantId: string;
  issuedAt: string;
  rail: "fiat" | "pool-wallet";
  settledAt: string;
  counterparty: string;
  corridor: string;
  source: { currency: string; value: string };
  destination: { currency: string; value: string };
  fxRate: string;
  txHash: string;
  txUrl: string;
  proofHash: string;
  ledger: string;
  bankRef: string;
  receiptId: string;
  legs: AttestationLeg[];
  signature: { alg: "HMAC-SHA256"; value: string; note: string };
};

type ReceiptJson = {
  id?: string;
  rail?: string;
  created?: string;
  amounts?: {
    source?: { currency?: string; value?: string };
    destination?: { currency?: string; value?: string };
  };
  fx?: { rate?: string };
  onchain?: { txHash?: string; ledger?: number; proofHash?: string };
  fiat?: { bankRef?: string };
};

/**
 * The immutable payment facts the signature covers (excludes `issuedAt` so the
 * signature is stable across re-downloads and verifiable against the payment).
 */
function signedFacts(a: {
  paymentId: string;
  tenantId: string;
  settledAt: string;
  source: { currency: string; value: string };
  destination: { currency: string; value: string };
  fxRate: string;
  txHash: string;
  proofHash: string;
  ledger: string;
  bankRef: string;
  receiptId: string;
}): Record<string, string> {
  return {
    paymentId: a.paymentId,
    tenantId: a.tenantId,
    settledAt: a.settledAt,
    sourceCurrency: a.source.currency,
    sourceValue: a.source.value,
    destinationCurrency: a.destination.currency,
    destinationValue: a.destination.value,
    fxRate: a.fxRate,
    txHash: a.txHash,
    proofHash: a.proofHash,
    ledger: a.ledger,
    bankRef: a.bankRef,
    receiptId: a.receiptId,
  };
}

function attestationKey(): Buffer {
  // Domain-separated signing key derived from the master key — the raw master
  // key is never used directly to sign.
  return createHmac("sha256", Buffer.from(env.MASTER_ENCRYPTION_KEY, "base64"))
    .update("trexure-attestation-v1")
    .digest();
}

function canonical(facts: Record<string, string>): string {
  return Object.keys(facts)
    .sort()
    .map((k) => `${k}=${facts[k]}`)
    .join("\n");
}

function sign(facts: Record<string, string>): string {
  return createHmac("sha256", attestationKey()).update(canonical(facts)).digest("hex");
}

/** Recompute the HMAC over the doc's stated facts and compare in constant time. */
export function verifyAttestation(att: Attestation): boolean {
  const expected = sign(signedFacts(att));
  const got = att.signature.value;
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(expected, "utf8"));
}

export async function buildAttestation(
  tenantId: string,
  paymentId: string,
  now: Date = new Date(),
): Promise<Attestation> {
  const db = forTenant(tenantId);
  const p = await db.payment.findFirst({
    where: { id: paymentId },
    include: { legs: true, receipt: true },
  });
  if (!p) throw new AppError(404, "Payment not found", `No payment ${paymentId} for this tenant.`);
  if (p.status !== "SETTLED") {
    throw new AppError(409, "Not settled", "An attestation can only be issued for a settled payment.");
  }

  const r = (p.receipt?.json ?? {}) as ReceiptJson;
  const onchainLeg = p.legs.find((l) => l.legType === "ONCHAIN");
  const fiatLeg = p.legs.find((l) => l.legType === "FIAT");
  const rail: "fiat" | "pool-wallet" =
    r.rail === "pool-wallet" || p.payoutMethod === "POOL_WALLET" ? "pool-wallet" : "fiat";

  const source = {
    currency: r.amounts?.source?.currency ?? p.sourceAsset,
    value: r.amounts?.source?.value ?? p.sourceAmount.toString(),
  };
  const destination = {
    currency: r.amounts?.destination?.currency ?? p.targetCurrency,
    value: r.amounts?.destination?.value ?? (p.targetAmount ? p.targetAmount.toString() : source.value),
  };
  const txHash = r.onchain?.txHash ?? onchainLeg?.txHash ?? "";
  const proofHash = r.onchain?.proofHash ?? p.proofHash ?? "";
  const ledger =
    r.onchain?.ledger != null
      ? String(r.onchain.ledger)
      : onchainLeg?.ledger != null
        ? String(onchainLeg.ledger)
        : "";
  const bankRef = r.fiat?.bankRef ?? fiatLeg?.bankRef ?? "";
  const receiptId = r.id ?? (p.receipt ? `rcpt_${p.id}` : "");
  const settledAt = r.created ?? p.updatedAt.toISOString();
  const fxRate = r.fx?.rate ?? "";

  const signature = {
    alg: "HMAC-SHA256" as const,
    value: sign(
      signedFacts({
        paymentId: p.id,
        tenantId,
        settledAt,
        source,
        destination,
        fxRate,
        txHash,
        proofHash,
        ledger,
        bankRef,
        receiptId,
      }),
    ),
    note: SIG_NOTE,
  };

  return {
    paymentId: p.id,
    tenantId,
    issuedAt: now.toISOString(),
    rail,
    settledAt,
    counterparty: p.recipientRef,
    corridor: `${p.corridorFrom} -> ${p.corridorTo}`,
    source,
    destination,
    fxRate,
    txHash,
    txUrl: EXPLORER_TX(txHash),
    proofHash,
    ledger,
    bankRef,
    receiptId,
    legs: p.legs.map((l) => ({
      legType: l.legType,
      status: l.status,
      txHash: l.txHash ?? "",
      bankRef: l.bankRef ?? "",
    })),
    signature,
  };
}

// ---- Renderers ------------------------------------------------------------

export function attestationToJson(att: Attestation): string {
  return JSON.stringify(att, null, 2);
}

export function attestationToReportDoc(att: Attestation): ReportDoc {
  const summary = [
    { label: "Payment ID", value: att.paymentId },
    { label: "Settled", value: att.settledAt },
    { label: "Counterparty", value: att.counterparty },
    { label: "Corridor", value: att.corridor },
    { label: "Amount paid", value: `${att.source.value} ${att.source.currency}` },
    { label: "Received", value: `${att.destination.value} ${att.destination.currency}` },
    ...(att.fxRate ? [{ label: "FX rate", value: att.fxRate }] : []),
    ...(att.bankRef ? [{ label: "Bank ref", value: att.bankRef }] : []),
    { label: "Receipt ID", value: att.receiptId },
    { label: "Rail", value: att.rail },
  ];

  return {
    title: "Proof of Payment Attestation",
    subtitle: `Tenant ${att.tenantId} — Payment ${att.paymentId} — issued ${att.issuedAt}`,
    summary,
    tables: [
      {
        heading: "Settlement legs",
        columns: ["Leg", "Status", "Tx / Ref"],
        rows: att.legs.map((l) => [l.legType, l.status, l.txHash || l.bankRef || "—"]),
      },
      {
        heading: "On-chain proof & verification",
        columns: ["Field", "Value"],
        rows: [
          ["On-chain tx", att.txHash || "—"],
          ["Verify at", att.txUrl || "—"],
          ["Proof hash", att.proofHash || "—"],
          ["Ledger", att.ledger || "—"],
          [`Signature (${att.signature.alg})`, att.signature.value],
          ["Note", att.signature.note],
        ],
      },
    ],
  };
}

export function attestationToPdf(att: Attestation): Promise<Buffer> {
  return renderReportPdf(attestationToReportDoc(att));
}

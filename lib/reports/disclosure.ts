import "server-only";
import { forTenant, prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { loadViewKey } from "../crypto/viewkey";
import { decryptWithViewKey } from "../zk";
import { logger } from "../log";
import { toCsv, type CsvColumn } from "./csv";
import { renderReportPdf, type ReportDoc, type ReportSummaryLine } from "./pdf";
import { rangeLabel, createdAtWithin, type DateRange } from "./scope";

/**
 * Compliance & Audit Disclosure Pack (R2) — the report only Trexure can produce.
 *
 * For a period (and optionally a single counterparty) it emits, per payment, the
 * details a company hands to its auditor / BIR / AMLC:
 *  - **Decrypted details** revealed by decrypting `encryptedPayload` with the
 *    tenant view key, server-side only. The view key never leaves the process and
 *    is zeroized after use (mirrors `app/api/payments/[id]/decrypt`).
 *  - **Proof it happened** — the on-chain tx hash + `proofHash` (ZK commitment)
 *    with a stellar.expert link an auditor can independently verify.
 *  - **Proof it settled** — both legs (ONCHAIN + FIAT) with statuses, realized FX,
 *    and bank ref; the receipt id.
 *
 * The disclosure is itself auditable: every revealed payment writes a
 * `viewkey.decrypt` AuditLog row and the pack writes one `report.disclosure` row,
 * so a regulator can see exactly what was revealed, by whom, and when.
 *
 * Builds on R1's reporting foundation (`lib/reports/{csv,pdf,scope}`).
 */

const EXPLORER_TX = (txHash: string): string =>
  txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : "";

export type DisclosedDetails = {
  sender: string;
  recipient: string;
  asset: string;
  amount: string;
  targetCurrency: string;
  intentId: string;
  memo: string;
};

export type DisclosureLeg = {
  legType: string;
  status: string;
  txHash: string;
  bankRef: string;
};

export type DisclosureEntry = {
  paymentId: string;
  date: string; // ISO createdAt
  status: string;
  counterparty: string; // recipientRef (opaque ref — always available, un-shielded)
  corridor: string; // "FROM -> TO"
  // Revealed by the view key. Null when the payment is not shielded or the
  // ciphertext could not be decrypted (the payment is still listed, with a note).
  disclosed: DisclosedDetails | null;
  disclosureNote: string;
  // Proof it happened.
  proofHash: string;
  txHash: string;
  txUrl: string;
  // Proof it settled.
  legs: DisclosureLeg[];
  fxRate: string;
  bankRef: string;
  receiptId: string;
};

export type DisclosurePack = {
  tenantId: string;
  range: { from: string; to: string };
  counterparty: string | null;
  generatedAt: string;
  generatedBy: string; // actor user id — the chain of disclosure
  paymentCount: number;
  revealedCount: number;
  entries: DisclosureEntry[];
};

type ReceiptJson = {
  id?: string;
  fx?: { rate?: string };
  onchain?: { txHash?: string };
  fiat?: { bankRef?: string };
};

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: { legs: true; receipt: true } }>;

const asStr = (v: unknown): string => (v == null ? "" : String(v));

function toDisclosed(payload: Record<string, unknown>): DisclosedDetails {
  return {
    sender: asStr(payload.sender),
    recipient: asStr(payload.recipient),
    asset: asStr(payload.asset),
    amount: asStr(payload.amount),
    targetCurrency: asStr(payload.targetCurrency),
    intentId: asStr(payload.intentId),
    memo: asStr(payload.memo),
  };
}

function toEntry(p: PaymentWithRelations, disclosed: DisclosedDetails | null, note: string): DisclosureEntry {
  const r = (p.receipt?.json ?? {}) as ReceiptJson;
  const onchainLeg = p.legs.find((l) => l.legType === "ONCHAIN");
  const fiatLeg = p.legs.find((l) => l.legType === "FIAT");
  const txHash = r.onchain?.txHash ?? onchainLeg?.txHash ?? "";

  return {
    paymentId: p.id,
    date: p.createdAt.toISOString(),
    status: p.status,
    counterparty: p.recipientRef,
    corridor: `${p.corridorFrom} -> ${p.corridorTo}`,
    disclosed,
    disclosureNote: note,
    proofHash: p.proofHash ?? "",
    txHash,
    txUrl: EXPLORER_TX(txHash),
    legs: p.legs.map((l) => ({
      legType: l.legType,
      status: l.status,
      txHash: l.txHash ?? "",
      bankRef: l.bankRef ?? "",
    })),
    fxRate: r.fx?.rate ?? "",
    bankRef: r.fiat?.bankRef ?? fiatLeg?.bankRef ?? "",
    receiptId: r.id ?? (p.receipt ? `rcpt_${p.id}` : ""),
  };
}

/**
 * Assemble a Disclosure Pack for a tenant. Decrypts each shielded payment under
 * the tenant view key and writes the audit trail. ADMIN-gate + tenant scoping are
 * enforced by the caller (route) / `forTenant`; this function is the sensitive
 * core, so it audits every reveal itself and never returns the view key.
 */
export async function buildDisclosurePack(
  tenantId: string,
  range: DateRange,
  opts: { counterparty?: string | null; actorUserId: string; ip?: string | null },
  now: Date = new Date(),
): Promise<DisclosurePack> {
  const db = forTenant(tenantId);
  const counterparty = opts.counterparty?.trim() || null;

  const payments = (await db.payment.findMany({
    where: {
      ...createdAtWithin(range),
      ...(counterparty ? { recipientRef: counterparty } : {}),
    },
    include: { legs: true, receipt: true },
    orderBy: { createdAt: "asc" },
  })) as PaymentWithRelations[];

  const hasShielded = payments.some((p) => p.encryptedPayload && p.payloadNonce);
  // Load the key lazily: a period with nothing to reveal must not 404 on a
  // missing view key, and we never hold the key longer than needed.
  const viewKey = hasShielded ? await loadViewKey(tenantId) : null;

  const entries: DisclosureEntry[] = [];
  const revealedIds: string[] = [];
  try {
    for (const p of payments) {
      if (!p.encryptedPayload || !p.payloadNonce) {
        entries.push(toEntry(p, null, "Not shielded — no encrypted payload on record"));
        continue;
      }
      try {
        const payload = await decryptWithViewKey(
          viewKey!,
          Buffer.from(p.encryptedPayload),
          Buffer.from(p.payloadNonce),
        );
        entries.push(toEntry(p, toDisclosed(payload), "Revealed under tenant view key"));
        revealedIds.push(p.id);
      } catch (err) {
        logger.error({ err, paymentId: p.id }, "disclosure decrypt failed");
        entries.push(toEntry(p, null, "Decrypt failed — payload unreadable with current view key"));
      }
    }
  } finally {
    viewKey?.fill(0); // zeroize — never returned, never logged
  }

  const revealedCount = revealedIds.length;
  const ip = opts.ip ?? null;
  const packTarget = `disclosure:${range.from.toISOString().slice(0, 10)}..${range.to
    .toISOString()
    .slice(0, 10)}${counterparty ? `:${counterparty}` : ""}`;

  // Fail-CLOSED audit: write every per-reveal `viewkey.decrypt` row (payment as
  // target, with caller IP) AND the pack-level `report.disclosure` row in ONE
  // transaction, UN-guarded, before the pack is returned. If the audit write
  // fails the whole disclosure aborts (the caller 500s) so shielded data is never
  // delivered without its audit trail — the compliance guarantee this report
  // exists to provide. (recordAudit's best-effort swallow is deliberately not
  // used here; a regulator must be able to see exactly what was revealed.)
  await prisma.$transaction([
    ...revealedIds.map((id) =>
      prisma.auditLog.create({
        data: {
          action: "viewkey.decrypt",
          tenantId,
          userId: opts.actorUserId,
          target: id,
          ip,
          metadata: { report: "disclosure" } as never,
        },
      }),
    ),
    prisma.auditLog.create({
      data: {
        action: "report.disclosure",
        tenantId,
        userId: opts.actorUserId,
        target: packTarget,
        ip,
        metadata: {
          report: "disclosure",
          counterparty,
          paymentCount: payments.length,
          revealedCount,
        } as never,
      },
    }),
  ]);

  return {
    tenantId,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    counterparty,
    generatedAt: now.toISOString(),
    generatedBy: opts.actorUserId,
    paymentCount: payments.length,
    revealedCount,
    entries,
  };
}

/**
 * Non-decrypting preview of what a pack WOULD contain, for the page. Reveals
 * nothing shielded and writes no audit row — only counts and the opaque
 * counterparty refs already stored in the clear.
 */
export async function previewDisclosureScope(
  tenantId: string,
  range: DateRange,
  counterparty?: string | null,
): Promise<{ paymentCount: number; shieldedCount: number; counterparties: string[] }> {
  const db = forTenant(tenantId);
  const cp = counterparty?.trim() || null;
  const payments = await db.payment.findMany({
    where: { ...createdAtWithin(range), ...(cp ? { recipientRef: cp } : {}) },
    select: { recipientRef: true, encryptedPayload: true, payloadNonce: true },
  });
  const counterparties = [...new Set(payments.map((p) => p.recipientRef))].sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    paymentCount: payments.length,
    shieldedCount: payments.filter((p) => p.encryptedPayload && p.payloadNonce).length,
    counterparties,
  };
}

// ---- Renderers ------------------------------------------------------------

const APPENDIX_COLUMNS: CsvColumn<DisclosureEntry>[] = [
  { header: "Date", value: (e) => e.date },
  { header: "Payment ID", value: (e) => e.paymentId },
  { header: "Counterparty Ref", value: (e) => e.counterparty },
  { header: "Sender", value: (e) => e.disclosed?.sender ?? "" },
  { header: "Recipient", value: (e) => e.disclosed?.recipient ?? "" },
  { header: "Amount", value: (e) => e.disclosed?.amount ?? "" },
  { header: "Asset", value: (e) => e.disclosed?.asset ?? "" },
  { header: "Target Currency", value: (e) => e.disclosed?.targetCurrency ?? "" },
  { header: "Memo", value: (e) => e.disclosed?.memo ?? "" },
  { header: "Status", value: (e) => e.status },
  { header: "On-chain Tx", value: (e) => e.txHash },
  { header: "Proof Hash", value: (e) => e.proofHash },
  { header: "FX Rate", value: (e) => e.fxRate },
  { header: "Bank Ref", value: (e) => e.bankRef },
  { header: "Receipt ID", value: (e) => e.receiptId },
  { header: "Disclosure", value: (e) => e.disclosureNote },
];

/** Machine-readable CSV appendix — one row per payment, auditors script against it. */
export function disclosurePackToCsv(pack: DisclosurePack): string {
  return toCsv(APPENDIX_COLUMNS, pack.entries);
}

/** Machine-readable JSON appendix. */
export function disclosurePackToJson(pack: DisclosurePack): string {
  return JSON.stringify(pack, null, 2);
}

export function disclosurePackToReportDoc(pack: DisclosurePack): ReportDoc {
  const summary: ReportSummaryLine[] = [
    { label: "Tenant", value: pack.tenantId },
    { label: "Period", value: rangeLabel({ from: new Date(pack.range.from), to: new Date(pack.range.to) }) },
    { label: "Counterparty", value: pack.counterparty ?? "All counterparties" },
    { label: "Generated", value: pack.generatedAt },
    { label: "Generated by", value: pack.generatedBy },
    { label: "Payments", value: String(pack.paymentCount) },
    { label: "Revealed", value: String(pack.revealedCount) },
    {
      label: "Verification",
      value: "On-chain tx + proofHash independently verifiable at stellar.expert",
    },
  ];

  return {
    title: "Compliance & Audit Disclosure Pack",
    subtitle: `Tenant ${pack.tenantId} — ${rangeLabel({
      from: new Date(pack.range.from),
      to: new Date(pack.range.to),
    })}`,
    summary,
    tables: [
      {
        heading: "Disclosed payments (revealed under tenant view key)",
        columns: ["Date", "Counterparty", "Sender", "Recipient", "Amount", "Target", "Memo", "Disclosure"],
        rows: pack.entries.map((e) => [
          e.date.slice(0, 10),
          e.counterparty,
          e.disclosed?.sender ?? "—",
          e.disclosed?.recipient ?? "—",
          e.disclosed ? `${e.disclosed.amount} ${e.disclosed.asset}` : "—",
          e.disclosed?.targetCurrency ?? "—",
          e.disclosed?.memo ?? "",
          e.disclosureNote,
        ]),
      },
      {
        heading: "Proof of settlement",
        columns: ["Date", "Counterparty", "Status", "On-chain Tx", "Proof Hash", "FX", "Bank Ref", "Receipt"],
        rows: pack.entries.map((e) => [
          e.date.slice(0, 10),
          e.counterparty,
          e.status,
          e.txHash,
          e.proofHash,
          e.fxRate,
          e.bankRef,
          e.receiptId,
        ]),
      },
    ],
  };
}

export function disclosurePackToPdf(pack: DisclosurePack): Promise<Buffer> {
  return renderReportPdf(disclosurePackToReportDoc(pack));
}

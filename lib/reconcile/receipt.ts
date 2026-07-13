import "server-only";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";

const D = Prisma.Decimal;

// Recompute-side constants (never client-supplied):
// Soroban inclusion fee for the private-payment invocation (Protocol 26 testnet).
const NETWORK_FEE_XLM = "0.00041";
// Flat anchor fee fallback when AnchorConfig.config.anchorFeeFlat is absent.
const DEFAULT_ANCHOR_FEE_FLAT = "50.00";

/**
 * Treasury Float Yield (#161 P4) — the yield block. Present only when the payment
 * had a `YieldPosition` (idle balance swept into YLDS between funding and
 * disbursement). Every figure is derived from the stored position so the receipt
 * never re-derives / drifts. Readers (PDF, ReceiptPanel, reconciliation) treat it
 * as optional and hide it when absent.
 */
export type YieldReceipt = {
  asset: string;
  status: string; // SWEPT_OUT (unwound) | FAILED (served from buffer)
  principal: string; // source-asset amount swept into yield
  accrued: string; // gross yield earned over the hold
  platformFee: string; // feeBps applied to the accrued yield
  netYield: string; // accrued − platformFee (to the tenant)
  feeBps: string;
  slippage: string; // round-trip swap slippage cost
  sweepInTx: string;
  sweepOutTx: string;
};

export type Receipt = {
  id: string;
  paymentId: string;
  status: "settled";
  created: string;
  corridor: { from: string; to: string };
  amounts: {
    source: { currency: string; value: string };
    destination: { currency: string; value: string };
  };
  fx: { rate: string; asOf: string };
  fees: { network: string; anchor: string; platform: string };
  slippage: string;
  onchain: { txHash: string; ledger: number; proofHash: string; asset: string };
  fiat: { provider: string; reference: string; bankRef: string };
  privacy: { shielded: boolean; viewKeyDisclosed: boolean };
  yield?: YieldReceipt;
};

type YieldPositionRow = {
  status: string;
  yieldAsset: string;
  principal: Prisma.Decimal;
  sweptInAmount: Prisma.Decimal | null;
  sweptOutAmount: Prisma.Decimal | null;
  accruedYield: Prisma.Decimal;
  feeBps: Prisma.Decimal;
  sweepInTxHash: string | null;
  sweepOutTxHash: string | null;
};

/** Derive the receipt yield block from a stored position (no re-derivation drift). */
export function buildYieldBlock(pos: YieldPositionRow): YieldReceipt {
  const principal = new D(pos.principal.toString());
  const accrued = new D(pos.accruedYield.toString());
  const platformFee = accrued.mul(new D(pos.feeBps.toString())).div(10000);
  const netYield = accrued.minus(platformFee);

  // Round-trip swap slippage: (principal − YLDS acquired) + (gross − USDC returned).
  const inSlip = pos.sweptInAmount ? principal.minus(new D(pos.sweptInAmount.toString())) : new D(0);
  const grossReturn = principal.plus(accrued);
  const outSlip = pos.sweptOutAmount
    ? grossReturn.minus(new D(pos.sweptOutAmount.toString()))
    : new D(0);
  const slippage = inSlip.plus(outSlip);

  return {
    asset: pos.yieldAsset,
    status: pos.status,
    principal: principal.toFixed(2),
    accrued: accrued.toFixed(8),
    platformFee: platformFee.toFixed(8),
    netYield: netYield.toFixed(8),
    feeBps: pos.feeBps.toString(),
    slippage: slippage.toFixed(8),
    sweepInTx: pos.sweepInTxHash ?? "",
    sweepOutTx: pos.sweepOutTxHash ?? "",
  };
}

export async function buildReceipt(paymentId: string): Promise<Receipt> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { legs: true, receipt: true, yieldPosition: true },
  });
  if (!payment) throw new Error(`buildReceipt: payment ${paymentId} not found`);

  const onchain = payment.legs.find((l) => l.legType === "ONCHAIN");
  const fiat = payment.legs.find((l) => l.legType === "FIAT");
  if (!onchain || !fiat) throw new Error("buildReceipt: both legs required");

  // Recompute from stored on-chain + anchor data — never trust a client amount.
  const source = new D(payment.sourceAmount.toString());
  const destination = new D((fiat.amount ?? payment.targetAmount ?? 0).toString());
  const quoted = payment.targetAmount ? new D(payment.targetAmount.toString()) : destination;

  const rate = source.gt(0) ? destination.div(source) : new D(0);
  const slippage = quoted.gt(0) ? quoted.minus(destination).div(quoted).abs() : new D(0);

  const anchorCfg = await prisma.anchorConfig.findFirst({ where: { tenantId: payment.tenantId } });
  const cfg = (anchorCfg?.config ?? null) as { anchorFeeFlat?: string } | null;
  const anchorFeeFlat =
    cfg && typeof cfg.anchorFeeFlat === "string" ? cfg.anchorFeeFlat : DEFAULT_ANCHOR_FEE_FLAT;

  const json: Receipt = {
    id: `rcpt_${payment.id}`,
    paymentId: payment.id,
    status: "settled",
    created: new Date().toISOString(),
    corridor: { from: payment.corridorFrom, to: payment.corridorTo },
    amounts: {
      source: { currency: payment.corridorFrom, value: source.toFixed(2) },
      destination: { currency: payment.corridorTo, value: destination.toFixed(2) },
    },
    fx: { rate: rate.toFixed(2), asOf: (fiat.receivedAt ?? new Date()).toISOString() },
    fees: {
      network: `${NETWORK_FEE_XLM} XLM`,
      anchor: `${payment.corridorTo} ${new D(anchorFeeFlat).toFixed(2)}`,
      platform: "0.00",
    },
    slippage: slippage.toFixed(4),
    onchain: {
      txHash: onchain.txHash ?? "",
      ledger: onchain.ledger ?? 0,
      proofHash: payment.proofHash ?? "",
      asset: payment.sourceAsset,
    },
    fiat: {
      provider: fiat.provider ?? "mock-anchor",
      reference: fiat.providerRef ?? "",
      bankRef: fiat.bankRef ?? "",
    },
    privacy: { shielded: payment.shielded, viewKeyDisclosed: false },
  };

  // Treasury Float Yield (#161 P4): surface the yield hops when the payment's
  // idle balance was swept — never hide the two swap legs from the receipt.
  if (payment.yieldPosition) {
    json.yield = buildYieldBlock(payment.yieldPosition);
  }

  await prisma.receipt.upsert({
    where: { paymentId: payment.id },
    create: { paymentId: payment.id, json: json as unknown as Prisma.InputJsonValue },
    update: { json: json as unknown as Prisma.InputJsonValue },
  });

  return json;
}

/**
 * On-chain-only receipt for a pool **wallet** claim (P4, #86). The pool withdraw
 * IS settlement (Rail A — no two-leg fiat match), so there is no `fiat` block and
 * no FX/anchor fee. Distinguished from the fiat receipt by `rail: "pool-wallet"`.
 * Renders through the same PDF path (lib/pdf/receipt.ts reads fields defensively).
 */
export type PoolReceipt = {
  id: string;
  paymentId: string;
  status: "settled";
  rail: "pool-wallet";
  created: string;
  corridor: { from: string; to: string };
  amounts: {
    source: { currency: string; value: string };
    destination: { currency: string; value: string };
  };
  onchain: { txHash: string; ledger: number; nullifierHash: string; asset: string };
  privacy: { shielded: boolean; viewKeyDisclosed: boolean };
};

export async function buildPoolWalletReceipt(paymentId: string): Promise<PoolReceipt> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { legs: true },
  });
  if (!payment) throw new Error(`buildPoolWalletReceipt: payment ${paymentId} not found`);

  const onchain = payment.legs.find((l) => l.legType === "ONCHAIN");
  if (!onchain) throw new Error("buildPoolWalletReceipt: on-chain leg required");

  // XLM in, XLM out — the withdrawn amount equals the source (no FX). 7-dp XLM.
  const value = new D(payment.sourceAmount.toString()).toFixed(7);

  const json: PoolReceipt = {
    id: `rcpt_${payment.id}`,
    paymentId: payment.id,
    status: "settled",
    rail: "pool-wallet",
    created: new Date().toISOString(),
    corridor: { from: payment.corridorFrom, to: payment.corridorTo },
    amounts: {
      source: { currency: payment.corridorFrom, value },
      destination: { currency: payment.corridorTo, value },
    },
    onchain: {
      txHash: onchain.txHash ?? "",
      ledger: onchain.ledger ?? 0,
      nullifierHash: payment.poolNullifierHash ?? "",
      asset: payment.sourceAsset,
    },
    privacy: { shielded: payment.shielded, viewKeyDisclosed: false },
  };

  await prisma.receipt.upsert({
    where: { paymentId: payment.id },
    create: { paymentId: payment.id, json: json as unknown as Prisma.InputJsonValue },
    update: { json: json as unknown as Prisma.InputJsonValue },
  });

  return json;
}

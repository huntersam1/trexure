import "server-only";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";

const D = Prisma.Decimal;

// Recompute-side constants (never client-supplied):
// Soroban inclusion fee for the private-payment invocation (Protocol 26 testnet).
const NETWORK_FEE_XLM = "0.00041";
// Flat anchor fee fallback when AnchorConfig.config.anchorFeeFlat is absent.
const DEFAULT_ANCHOR_FEE_FLAT = "50.00";

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
};

export async function buildReceipt(paymentId: string): Promise<Receipt> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { legs: true, receipt: true },
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

  await prisma.receipt.upsert({
    where: { paymentId: payment.id },
    create: { paymentId: payment.id, json: json as unknown as Prisma.InputJsonValue },
    update: { json: json as unknown as Prisma.InputJsonValue },
  });

  return json;
}

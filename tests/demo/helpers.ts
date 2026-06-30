import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";

/** Creates a tenant + a SETTLED sample payment with both legs and a receipt. */
export async function seedSampleForTest(): Promise<{ tenantId: string; paymentId: string }> {
  const tenant = await prisma.tenant.create({ data: { name: `demo-${randomUUID()}` } });
  const payment = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      intentId: `intent_${randomUUID()}`,
      status: "SETTLED",
      sourceAsset: "USDC",
      sourceAmount: "2500.00000000",
      targetCurrency: "PHP",
      targetAmount: "141750.00000000",
      corridorFrom: "USD",
      corridorTo: "PHP",
      recipientRef: "contractor-001",
      shielded: true,
      proofHash: "abc123",
      legs: {
        create: [
          { legType: "ONCHAIN", status: "CONFIRMED", txHash: "tx_demo", ledger: 123456 },
          { legType: "FIAT", status: "RECEIVED", provider: "mock-anchor", providerRef: "mock_payout_x", bankRef: "PH-BANK-1", amount: "141750.00000000", currency: "PHP" },
        ],
      },
      receipt: { create: { json: { id: "rcpt_demo", status: "settled" } } },
    },
  });
  return { tenantId: tenant.id, paymentId: payment.id };
}

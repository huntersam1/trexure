import type { CreatePaymentInput } from "../validation/payments";

/**
 * Canonical shielded-payload shape. The `sender`/`recipient`/`asset`/`amount`
 * keys are the contract the Internal Enclave UI reads (see
 * `DecryptedPayload` in lib/ui/types.ts + EnclavePanel). The seed and signup
 * fixtures encrypt this same shape; keeping createPayment aligned means a
 * user-created payment decrypts to the same fields the demo sample does.
 *
 * `intentId` is NOT displayed but MUST stay: shield() derives the ZK proof
 * binding from `payload.intentId` (lib/zk/index.ts).
 */
export type ShieldPayload = {
  sender: string;
  recipient: string;
  asset: string;
  amount: string;
  targetCurrency: string;
  intentId: string;
  memo?: string;
};

export function buildShieldPayload(
  input: CreatePaymentInput,
  ctx: { tenantName: string; intentId: string },
): ShieldPayload {
  return {
    sender: ctx.tenantName,
    recipient: input.recipientRef,
    asset: input.sourceAsset,
    amount: input.amount,
    targetCurrency: input.targetCurrency,
    intentId: ctx.intentId,
    // The optional user memo is private data: it lives only in the shielded
    // payload. Soroban txs cannot carry classic memos (#30).
    ...(input.memo ? { memo: input.memo } : {}),
  };
}

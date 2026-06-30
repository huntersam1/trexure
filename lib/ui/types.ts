export type PaymentStatus =
  | "DRAFT"
  | "PENDING"
  | "ONCHAIN_CONFIRMED"
  | "RECONCILING"
  | "SETTLED"
  | "FAILED";

export type BadgeState = "PENDING" | "VERIFIED" | "RECONCILING" | "SETTLED" | "FAILED";

export type PaymentSummary = {
  id: string;
  status: PaymentStatus;
  sourceAsset: string;
  sourceAmount: string; // decimal string — never JS number
  targetCurrency: string;
  corridorFrom: string;
  corridorTo: string;
  createdAt: string; // ISO
  settledAt: string | null; // ISO or null
};

export type PaymentLegView = {
  legType: "ONCHAIN" | "FIAT";
  status: "PENDING" | "RECEIVED" | "CONFIRMED" | "FAILED";
  txHash: string | null;
  ledger: number | null;
  contractId: string | null;
  provider: string | null;
  providerRef: string | null;
  bankRef: string | null;
  amount: string | null;
  currency: string | null;
};

export type PaymentDetail = {
  id: string;
  intentId: string;
  status: PaymentStatus;
  shielded: boolean;
  proofHash: string | null;
  encryptedPayloadB64: string | null; // base64 of the shielded blob, for the Beat 1 display only
  sourceAsset: string;
  sourceAmount: string;
  targetCurrency: string;
  corridorFrom: string;
  corridorTo: string;
  createdAt: string;
  legs: PaymentLegView[];
  hasReceipt: boolean;
};

// SPEC §6.4 receipt shape
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

// Returned (as `payload`) by POST /api/payments/:id/decrypt (server-side; view key NEVER included)
export type DecryptedPayload = {
  sender: string;
  recipient: string;
  asset: string;
  amount: string;
  memo?: string;
};

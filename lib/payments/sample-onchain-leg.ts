import { env } from "@/lib/env";
import { logger } from "@/lib/log";

// Shared by BOTH seeders (prisma/seed.ts, run via `tsx --conditions=react-server`,
// and lib/auth/signup.ts) so the sample payment's on-chain leg can't drift
// between them (#45). Produces either a REAL, explorer-linkable testnet leg
// (SEED_ONCHAIN=true + a funded key) or the offline placeholder used by
// `docker compose up && pnpm db:seed` and CI.

export type SampleOnchainLeg = {
  status: "CONFIRMED";
  txHash: string;
  ledger: number;
  contractId: string;
  /** Which path produced this leg — for logging/tests, not persisted. */
  mode: "real" | "placeholder";
};

// A Stellar Ed25519 secret seed is 56 chars, base32, starting with "S". This is
// a cheap sanity gate; a genuinely bad key still fails the submit and falls back.
const looksFunded = (secret: string): boolean => /^S[A-Z2-7]{55}$/.test(secret);

/**
 * Build the sample payment's ONCHAIN leg data (real-or-placeholder). Callers
 * persist the returned fields their own way (seed upserts the leg; signup nests
 * it in the create). The real submit is a network call — call this OUTSIDE any
 * DB transaction.
 *
 * @param placeholderRef a stable, caller-unique string; the offline leg's
 *        txHash is `demo_tx_<first 8 chars>`.
 */
export async function buildSampleOnchainLeg(args: {
  intentId: string;
  amount: string; // human units, e.g. "2500.00"
  sourceAsset: string; // e.g. "USDC"
  proofHash: string; // the payment's real ZK commitment (recorded on-chain)
  placeholderRef: string;
}): Promise<SampleOnchainLeg> {
  const placeholder = (): SampleOnchainLeg => {
    const leg: SampleOnchainLeg = {
      status: "CONFIRMED",
      txHash: `demo_tx_${args.placeholderRef.slice(0, 8)}`,
      ledger: 1234567,
      contractId: env.ZK_CONTRACT_ID,
      mode: "placeholder",
    };
    logger.info({ intentId: args.intentId, onchain: "placeholder", txHash: leg.txHash }, "sample on-chain leg (placeholder)");
    return leg;
  };

  if (!env.SEED_ONCHAIN) return placeholder();
  if (!looksFunded(env.STELLAR_SOURCE_SECRET)) {
    logger.warn({ intentId: args.intentId }, "SEED_ONCHAIN=true but STELLAR_SOURCE_SECRET is not a funded testnet secret; using placeholder leg");
    return placeholder();
  }

  try {
    // Dynamic import: the offline path never loads the Stellar SDK, and (outside
    // the react-server condition) never trips the `server-only` guard.
    const { buildAndSubmitPrivatePayment } = await import("@/lib/stellar/client");
    const { txHash, ledger, contractId } = await buildAndSubmitPrivatePayment({
      intentId: args.intentId,
      amount: args.amount,
      sourceAsset: args.sourceAsset,
      commitment: args.proofHash,
    });
    logger.info({ intentId: args.intentId, onchain: "real", txHash, ledger }, "sample on-chain leg (REAL testnet tx)");
    return { status: "CONFIRMED", txHash, ledger, contractId, mode: "real" };
  } catch (err) {
    logger.error({ err, intentId: args.intentId }, "SEED_ONCHAIN real submit failed; falling back to placeholder leg");
    return placeholder();
  }
}

// Shared client+server constants for Demo Replay. NO secrets, NO server-only import.
// SAMPLE_INTENT_ID matches the seed's sample payment (prisma/seed.ts).
export const SAMPLE_INTENT_ID = "intent_seed_demo_usd_php_0001";

export const BEAT_PACING = {
  decryptRevealMs: 1200,
  payoutDelayMs: 1800, // visible Pending→Settled latency passed to mock-anchor
  pollIntervalMs: 1000,
  pollTimeoutMs: 30000,
  beatGapMs: 800,
} as const;

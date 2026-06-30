import "server-only";

/**
 * Phase 3: re-export the labeled stub. Phase 6 swaps this file's body for the real
 * forked-SPP implementation (adding decryptWithViewKey + verifyProofOnChain) WITHOUT
 * changing the `shield`/`ShieldedPayload` signatures consumed by lib/payments/service.ts.
 */
export type { ShieldedPayload } from "./stub";
export { shield } from "./stub";

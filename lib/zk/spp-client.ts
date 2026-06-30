import "server-only";

import {
  rpc,
  Contract,
  Keypair,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

import { env } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { loadViewKey } from "@/lib/crypto/viewkey";
import { AppError } from "@/lib/http/problem";
import { logger } from "@/lib/log";

// ---------------------------------------------------------------------------
// Real Groth16 ZK lives in lib/zk/groth16.ts (snarkjs BLS12-381 prover) + the
// deployed Soroban verifier contract (zk/deploy.json). This module keeps the
// tenant shield-key resolution and the on-chain verify gate.
// ---------------------------------------------------------------------------

/**
 * True when the real ZK proving path is enabled: the on-chain verifier is
 * configured AND proving is explicitly opted in (ZK_PROVING=live). When false,
 * `shield` uses the labeled AES-wrap fallback (no faked verification).
 */
export async function isSppAvailable(): Promise<boolean> {
  return Boolean(env.ZK_CONTRACT_ID) && process.env.ZK_PROVING === "live";
}

/**
 * Resolve the symmetric note-encryption key `shield` uses. In the forked-SPP
 * model this is the tenant's viewing key held by the proving context; here it
 * is the same persistent tenant view key that POST /api/payments/[id]/decrypt
 * later uses to unwrap the payload. Resolved from the AUTHENTICATED tenant —
 * `shield` is only ever called inside a tenant request.
 */
export async function getShieldKey(): Promise<Buffer> {
  const session = await requireSession();
  const vk = await loadViewKey(session.tenantId);
  if (!vk) {
    throw new AppError(409, "No view key", "Tenant has no view key configured; cannot shield payload");
  }
  return vk;
}

/**
 * REAL on-chain proof verification: read-only simulation of `verify_proof`
 * against the Groth16 verifier contract (ZK_CONTRACT_ID). This is NEVER mocked.
 * A simulation error throws — verification never silently passes.
 */
export async function sppVerifyOnChain(proofHash: string): Promise<boolean> {
  const server = new rpc.Server(env.STELLAR_RPC_URL, {
    allowHttp: env.STELLAR_RPC_URL.startsWith("http://"),
  });
  const source = Keypair.fromSecret(env.STELLAR_SOURCE_SECRET).publicKey();
  const account = await server.getAccount(source);
  const contract = new Contract(env.ZK_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "verify_proof",
        nativeToScVal(Buffer.from(proofHash.replace(/^0x/, ""), "hex"), { type: "bytes" }),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError(502, "Proof verification unavailable", "Groth16 verifier simulation failed");
  }
  const retval = (sim as { result: { retval: unknown } }).result.retval;
  return scValToNative(retval as Parameters<typeof scValToNative>[0]) === true;
}

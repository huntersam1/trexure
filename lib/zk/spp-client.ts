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
// FORKED-SPP WIRING — vendored under vendor/spp (see vendor/spp/README.md).
// Trexure authors NO circuits. The fork supplies the privacy-pool contracts,
// the Circom circuits, and the WASM prover (`@trexure/spp`). We only (a) submit
// a private payment + obtain a proof, and (b) verify proofs on-chain via the
// Groth16 verifier contract (ZK_CONTRACT_ID).
// ---------------------------------------------------------------------------

type SppModule = {
  proveDeposit(args: {
    payload: Record<string, unknown>;
    noteKey: Buffer;
    contractId: string;
  }): Promise<{ proof: Buffer; txHash: string }>;
};

let _spp: SppModule | null | undefined;

async function loadSpp(): Promise<SppModule | null> {
  if (_spp !== undefined) return _spp;
  try {
    // Vendored forked-SPP WASM prover. Present only when the fork is wired.
    _spp = (await import("@trexure/spp")) as unknown as SppModule;
  } catch {
    _spp = null; // not wired yet → caller uses the labeled fallback
  }
  return _spp;
}

/** True only when the REAL SPP proving path is wired and explicitly enabled. */
export async function isSppAvailable(): Promise<boolean> {
  if (!env.ZK_CONTRACT_ID) return false;
  if (process.env.ZK_SPP_PROVING !== "live") return false; // explicit opt-in
  return (await loadSpp()) !== null;
}

/** REAL forked-SPP proving (WASM + privacy-pool submit). Throws if not wired. */
export async function sppProve(
  payload: Record<string, unknown>,
  noteKey: Buffer,
): Promise<{ proof: Buffer }> {
  const spp = await loadSpp();
  if (!spp) {
    throw new AppError(503, "SPP prover unavailable", "Forked SPP WASM prover not loaded");
  }
  const { proof } = await spp.proveDeposit({
    payload,
    noteKey,
    contractId: env.ZK_CONTRACT_ID,
  });
  return { proof };
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

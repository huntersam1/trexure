import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so these exist before the hoisted vi.mock factory runs (TDZ).
const { mockSimulate, mockGetAccount, ContractMock } = vi.hoisted(() => ({
  mockSimulate: vi.fn(),
  mockGetAccount: vi.fn(async () => ({})),
  ContractMock: vi.fn().mockImplementation((id: string) => ({
    call: vi.fn(() => ({ __op: `call:${id}` })),
  })),
}));

vi.mock("@stellar/stellar-sdk", () => {
  class Server {
    simulateTransaction = mockSimulate;
    getAccount = mockGetAccount;
  }
  class TransactionBuilder {
    addOperation() { return this; }
    setTimeout() { return this; }
    build() { return { __tx: true }; }
  }
  return {
    rpc: { Server, Api: { isSimulationError: (s: any) => !!s.error } },
    Contract: ContractMock,
    Keypair: { fromSecret: () => ({ publicKey: () => "GSOURCE" }) },
    TransactionBuilder,
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    nativeToScVal: (v: any) => v,
    scValToNative: (v: any) => v,
  };
});

import { sppVerifyOnChain } from "@/lib/zk/spp-client";

describe("sppVerifyOnChain (REAL on-chain Groth16 verify)", () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    ContractMock.mockClear();
  });

  it("invokes the verifier contract on-chain and returns its boolean", async () => {
    mockSimulate.mockResolvedValue({ result: { retval: true } });
    const ok = await sppVerifyOnChain("0xdeadbeef");
    expect(ok).toBe(true);
    expect(ContractMock).toHaveBeenCalledWith(process.env.ZK_CONTRACT_ID);
    expect(mockSimulate).toHaveBeenCalledTimes(1); // not bypassed
  });

  it("throws on simulation error (never silently passes verification)", async () => {
    mockSimulate.mockResolvedValue({ error: "verifier reverted" });
    await expect(sppVerifyOnChain("0xbad")).rejects.toThrow();
  });
});

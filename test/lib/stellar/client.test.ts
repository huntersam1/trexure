import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock @stellar/stellar-sdk so no network/testnet call happens ---
const sendTransaction = vi.fn();
const getTransaction = vi.fn();
const getEvents = vi.fn();
const getAccount = vi.fn();
const prepareTransaction = vi.fn(async (tx: unknown) => tx);

vi.mock("@stellar/stellar-sdk", () => {
  class FakeKeypair {
    static fromSecret() { return new FakeKeypair(); }
    publicKey() { return "GSOURCEPUBLICKEY"; }
    sign() {}
  }
  class FakeContract {
    constructor(public id: string) {}
    call() { return { _op: "invoke" }; }
  }
  class FakeTransactionBuilder {
    addOperation() { return this; }
    addMemo() { return this; }
    setTimeout() { return this; }
    build() { return { sign: vi.fn(), hash: () => Buffer.from("deadbeef") }; }
  }
  return {
    rpc: {
      Server: vi.fn().mockImplementation(() => ({
        getAccount, prepareTransaction, sendTransaction, getTransaction, getEvents,
      })),
      Api: { GetTransactionStatus: { SUCCESS: "SUCCESS" } },
    },
    Keypair: FakeKeypair,
    Contract: FakeContract,
    TransactionBuilder: vi.fn().mockImplementation(() => new FakeTransactionBuilder()),
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    Memo: { text: (t: string) => ({ _memo: t }) },
    BASE_FEE: "100",
    nativeToScVal: (v: unknown) => ({ _scval: v }),
  };
});

vi.mock("../../../lib/env", () => ({
  env: {
    STELLAR_NETWORK: "testnet",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    STELLAR_SOURCE_SECRET: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    ZK_CONTRACT_ID: "CCONTRACTID",
  },
}));
vi.mock("../../../lib/log", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  getAccount.mockResolvedValue({ accountId: () => "GSOURCEPUBLICKEY", sequenceNumber: () => "1" });
  sendTransaction.mockResolvedValue({ status: "PENDING", hash: "abc123" });
  getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 555, txHash: "abc123" });
});

describe("buildAndSubmitPrivatePayment", () => {
  it("builds, server-signs and submits a Soroban tx and returns {txHash, ledger, contractId}", async () => {
    const { buildAndSubmitPrivatePayment } = await import("../../../lib/stellar/client");
    const res = await buildAndSubmitPrivatePayment({
      intentId: "intent_1", amount: "2500.00", sourceAsset: "USDC", memo: "intent_1",
    });
    expect(res.txHash).toBe("abc123");
    expect(res.ledger).toBe(555);
    expect(res.contractId).toBe("CCONTRACTID");
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it("throws when the network rejects the submission", async () => {
    sendTransaction.mockResolvedValueOnce({ status: "ERROR", errorResultXdr: "AAAA" });
    const { buildAndSubmitPrivatePayment } = await import("../../../lib/stellar/client");
    await expect(
      buildAndSubmitPrivatePayment({ intentId: "i", amount: "1", sourceAsset: "USDC", memo: "i" }),
    ).rejects.toThrow(/submission/i);
  });
});

describe("getContractEvents", () => {
  it("maps Soroban getEvents into [{txHash, ledger, proofHash}]", async () => {
    getEvents.mockResolvedValueOnce({
      events: [
        { txHash: "tx1", ledger: 600, value: "proofhash_1" },
        { txHash: "tx2", ledger: 601, value: "proofhash_2" },
      ],
    });
    const { getContractEvents } = await import("../../../lib/stellar/client");
    const out = await getContractEvents({ contractId: "CCONTRACTID", topic: "shielded", startLedger: 500 });
    expect(out).toEqual([
      { txHash: "tx1", ledger: 600, proofHash: "proofhash_1" },
      { txHash: "tx2", ledger: 601, proofHash: "proofhash_2" },
    ]);
    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 500 }),
    );
  });
});

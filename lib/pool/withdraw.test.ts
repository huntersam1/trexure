import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import { groth16 } from "snarkjs";
import { Keypair } from "@stellar/stellar-sdk";

import { generateNote } from "./note";
import { PoolMerkleTree } from "./tree";
import { recipientToField } from "./address";
import { buildWithdrawProof } from "./withdraw";

const vk = JSON.parse(
  readFileSync(path.join(process.cwd(), "zk", "artifacts", "withdraw_vk.json"), "utf8"),
);

describe("pool withdraw — proof gen/encode integration (P4, #63)", () => {
  it("proves a note's membership and the proof verifies off-chain + binds the tree root", async () => {
    const note = generateNote(1234560000n);
    const tree = new PoolMerkleTree();
    const leafIndex = tree.insert(note.commitment);
    const recipientPublicKey = Keypair.random().publicKey();

    const res = await buildWithdrawProof({ note, recipientPublicKey, tree, leafIndex });

    // Real Groth16 proof verifies against the committed verifying key.
    expect(await groth16.verify(vk, res.publicSignals, res.proof)).toBe(true);

    // Public signals order = [root, nullifierHash, recipient, amount].
    expect(res.publicSignals[0]).toBe(tree.root.toString());
    expect(res.publicSignals[1]).toBe(note.nullifierHash.toString());
    expect(res.publicSignals[2]).toBe(recipientToField(recipientPublicKey).toString());
    expect(res.publicSignals[3]).toBe(note.amount.toString());

    // Encoded for the contract: root bytes == the tree root, amount == note amount.
    expect(res.encoded.amount).toBe(note.amount);
    expect(res.encoded.root.length).toBe(32);
    expect(res.encoded.negA.length).toBe(96);
  }, 30_000);

  it("rejects a leafIndex that is not in the tree", async () => {
    const note = generateNote(1n);
    const tree = new PoolMerkleTree();
    tree.insert(note.commitment);
    await expect(
      buildWithdrawProof({ note, recipientPublicKey: Keypair.random().publicKey(), tree, leafIndex: 5 }),
    ).rejects.toThrow(/index/i);
  });
});

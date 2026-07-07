import { describe, it, expect } from "vitest";

import { commitmentHash, hash2 } from "./mimc";
import { PoolMerkleTree, POOL_TREE_DEPTH, poolZeros } from "./tree";

// Fold a leaf up its Merkle path exactly as the circuit's DualMux does:
// (left,right) = pathIndices==0 ? (cur, sibling) : (sibling, cur).
function foldPath(leaf: bigint, pathElements: bigint[], pathIndices: number[]): bigint {
  let cur = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    const [l, r] = pathIndices[i] === 0 ? [cur, pathElements[i]!] : [pathElements[i]!, cur];
    cur = hash2(l, r);
  }
  return cur;
}

describe("pool tree (P4, #63)", () => {
  it("uses depth 4 to match the deployed pool (#74)", () => {
    expect(POOL_TREE_DEPTH).toBe(4);
  });

  it("empty tree root is the all-zero subtree hash at the top level", () => {
    const zeros = poolZeros(POOL_TREE_DEPTH);
    expect(new PoolMerkleTree().root).toBe(zeros[POOL_TREE_DEPTH]);
  });

  it("reproduces the on-chain root for the demo deposit (P2/P3 agreement)", () => {
    // The exact note the committed withdraw proof was generated against.
    const commitment = commitmentHash(111111n, 222222n, 1234560000n);
    const tree = new PoolMerkleTree();
    const index = tree.insert(commitment);
    expect(index).toBe(0);
    // Public signal [0] of zk/artifacts/withdraw_public.json — the on-chain root.
    expect(tree.root.toString()).toBe(
      "49224446385761341098269984459245934562390653126053356294508444506784273203662",
    );
  });

  it("builds a path that folds back to the root (single leaf)", () => {
    const commitment = commitmentHash(111111n, 222222n, 1234560000n);
    const tree = new PoolMerkleTree();
    tree.insert(commitment);
    const { pathElements, pathIndices } = tree.buildPath(0);
    expect(pathIndices).toEqual([0, 0, 0, 0]);
    expect(foldPath(commitment, pathElements, pathIndices)).toBe(tree.root);
  });

  it("builds correct paths for every leaf in a multi-deposit tree", () => {
    const leaves = [10n, 20n, 30n, 40n, 50n].map((n) => commitmentHash(n, n + 1n, 100n));
    const tree = new PoolMerkleTree();
    leaves.forEach((l) => tree.insert(l));
    leaves.forEach((leaf, i) => {
      const { pathElements, pathIndices } = tree.buildPath(i);
      expect(foldPath(leaf, pathElements, pathIndices)).toBe(tree.root);
    });
  });

  it("PoolMerkleTree.from(leaves) equals inserting them one by one", () => {
    const leaves = [1n, 2n, 3n].map((n) => commitmentHash(n, n, n));
    const built = new PoolMerkleTree();
    leaves.forEach((l) => built.insert(l));
    expect(PoolMerkleTree.from(leaves).root).toBe(built.root);
  });

  it("rejects inserting past capacity (2^depth leaves)", () => {
    const tree = new PoolMerkleTree();
    for (let i = 0; i < 16; i++) tree.insert(BigInt(i + 1));
    expect(() => tree.insert(999n)).toThrow(/full|capacity/i);
  });
});

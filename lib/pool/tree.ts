import { hash2, toField } from "./mimc";

/**
 * Off-chain incremental Merkle mirror of the shielded pool (P4, #63). Rebuilds
 * the tree the P3 contract keeps on-chain so we can produce `pathElements` /
 * `pathIndices` for a withdraw proof (P2). It MUST reproduce the on-chain root
 * bit-for-bit for the same leaf set (locked by the demo-deposit test).
 *
 * Depth is **4** to match the deployed pool (#74 — deeper trees exceed Soroban's
 * per-tx MiMC budget), giving a 2^4 = 16-leaf anonymity set. Empty subtrees hash
 * to the precomputed `poolZeros` values (zeros[0] = 0, zeros[i+1] =
 * hash2(zeros[i], zeros[i])), matching the circuit and contract.
 */
export const POOL_TREE_DEPTH = 4;

/** Precomputed all-zero subtree hashes: zeros[i] = hash of an empty height-i subtree. */
export function poolZeros(depth: number): bigint[] {
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) zeros.push(hash2(zeros[i - 1]!, zeros[i - 1]!));
  return zeros;
}

export class PoolMerkleTree {
  readonly depth: number;
  readonly leaves: bigint[] = [];
  private readonly capacity: number;

  constructor(depth: number = POOL_TREE_DEPTH) {
    this.depth = depth;
    this.capacity = 1 << depth;
  }

  /** Build a tree from a known leaf set (e.g. synced from `deposit` events). */
  static from(leaves: bigint[], depth: number = POOL_TREE_DEPTH): PoolMerkleTree {
    const tree = new PoolMerkleTree(depth);
    leaves.forEach((l) => tree.insert(l));
    return tree;
  }

  /** Append a leaf; returns its index. Throws once the tree is full. */
  insert(leaf: bigint): number {
    if (this.leaves.length >= this.capacity) {
      throw new Error(`PoolMerkleTree: full (capacity ${this.capacity} = 2^${this.depth})`);
    }
    this.leaves.push(toField(leaf));
    return this.leaves.length - 1;
  }

  /**
   * Full node table, bottom-up. Level 0 is the leaves padded to 2^depth with 0n;
   * because empty leaves are 0 and hash2(0,0)=zeros[1] …, padded subtrees equal
   * the `poolZeros` values automatically. Depth 4 = at most 15 hashes, so we
   * simply recompute rather than cache.
   */
  private levels(): bigint[][] {
    const level0 = this.leaves.slice();
    while (level0.length < this.capacity) level0.push(0n);
    const levels: bigint[][] = [level0];
    for (let l = 0; l < this.depth; l++) {
      const prev = levels[l]!;
      const next: bigint[] = [];
      for (let j = 0; j < prev.length; j += 2) next.push(hash2(prev[j]!, prev[j + 1]!));
      levels.push(next);
    }
    return levels;
  }

  /** Current tree root (equals the on-chain root for the same leaves). */
  get root(): bigint {
    return this.levels()[this.depth]![0]!;
  }

  /**
   * Merkle authentication path for the leaf at `index`: the sibling at each
   * level (`pathElements`) and whether the current node is the left (0) or right
   * (1) child (`pathIndices`) — the exact private inputs the withdraw circuit
   * consumes.
   */
  buildPath(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`PoolMerkleTree: no leaf at index ${index}`);
    }
    const levels = this.levels();
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let l = 0; l < this.depth; l++) {
      const isRight = idx & 1;
      const siblingIndex = isRight ? idx - 1 : idx + 1;
      pathElements.push(levels[l]![siblingIndex]!);
      pathIndices.push(isRight);
      idx >>= 1;
    }
    return { pathElements, pathIndices };
  }
}

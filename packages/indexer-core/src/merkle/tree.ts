/**
 * General-purpose incremental Merkle tree — ported from
 * packages/wallet-core/src/merkleTree.ts (itself ported from
 * packages/contracts/test/helpers/merkleSim.ts, already proven correct against the
 * real MerkleTree.sol's _insert() in Phase 1's EndToEnd test — same zero-value
 * convention, same Poseidon(2) hashing, same depth-20 layout). Ported rather than
 * imported: wallet-core also depends on `idb` (browser-only IndexedDB), a real
 * layering violation for this Node-only package — the same reasoning already
 * applied to listener/retry.ts.
 */
/**
 * Which tree a global leaf index belongs to. A pool holds a sequence of trees; when one
 * is full the next leaf starts a new one (MerkleTree.sol, pre-mainnet review R1). Leaf
 * indices stay global, so leaf `i` lives in tree `i >> depth`. Mirrors
 * wallet-core's merkleTree.ts.
 */
export function treeNumberOf(leafIndex: number, depth: number): number {
  return Math.floor(leafIndex / 2 ** depth);
}

/**
 * Reconstructs a pool's trees from its leaves, in global leaf order. `root()` is the
 * root of the tree holding the most recent leaf (what the contract's root() returns),
 * and `proofForLeaf(i)` proves leaf `i` inside its own tree, against that tree's
 * current root — its final root once full, which the contract accepts forever.
 */
export function createMerkleTree(poseidon2: (a: bigint, b: bigint) => bigint, depth: number) {
  const zeros: bigint[] = [0n];
  for (let i = 1; i < depth; i++) zeros.push(poseidon2(zeros[i - 1], zeros[i - 1]));

  const perTree = 2 ** depth;
  const leaves: bigint[] = [];

  function insert(leaf: bigint): number {
    leaves.push(leaf);
    return leaves.length - 1;
  }

  // Hash of node `index` at `level` inside the tree whose first leaf is `base`.
  function nodeHash(base: number, level: number, index: number): bigint {
    const end = Math.min(leaves.length, base + perTree);
    if (level === 0) {
      return base + index < end ? leaves[base + index] : 0n;
    }
    const levelWidth = 2 ** level;
    const leafStart = base + index * levelWidth;
    if (leafStart >= end) {
      return zeros[level];
    }
    const left = nodeHash(base, level - 1, index * 2);
    const right = nodeHash(base, level - 1, index * 2 + 1);
    return poseidon2(left, right);
  }

  function emptyRoot(): bigint {
    return poseidon2(zeros[depth - 1], zeros[depth - 1]);
  }

  function rootOfTree(treeNumber: number): bigint {
    const base = treeNumber * perTree;
    return base >= leaves.length ? emptyRoot() : nodeHash(base, depth, 0);
  }

  function root(): bigint {
    return leaves.length === 0 ? emptyRoot() : rootOfTree(treeNumberOf(leaves.length - 1, depth));
  }

  function proofForLeaf(leafIndex: number): { root: string; siblings: string[]; pathIndices: number[]; treeNumber: number } {
    const treeNumber = treeNumberOf(leafIndex, depth);
    const base = treeNumber * perTree;
    const siblings: string[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex - base;
    for (let level = 0; level < depth; level++) {
      const isRight = idx % 2 === 1;
      const siblingIndex = isRight ? idx - 1 : idx + 1;
      siblings.push(toHex32(nodeHash(base, level, siblingIndex)));
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { root: toHex32(rootOfTree(treeNumber)), siblings, pathIndices, treeNumber };
  }

  return { insert, proofForLeaf, root, rootOfTree, leafCount: () => leaves.length, leaves: () => leaves.slice(), zeros };
}

export type MerkleTreeInstance = ReturnType<typeof createMerkleTree>;

export function toHex32(value: bigint): string {
  if (value < 0n) throw new Error("toHex32: negative value");
  return "0x" + value.toString(16).padStart(64, "0");
}

export function fromHex(value: string): bigint {
  return BigInt(value);
}

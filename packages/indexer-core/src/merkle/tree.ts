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
export function createMerkleTree(poseidon2: (a: bigint, b: bigint) => bigint, depth: number) {
  const zeros: bigint[] = [0n];
  for (let i = 1; i < depth; i++) zeros.push(poseidon2(zeros[i - 1], zeros[i - 1]));

  const leaves: bigint[] = [];

  function insert(leaf: bigint): number {
    leaves.push(leaf);
    return leaves.length - 1;
  }

  function nodeHash(level: number, index: number): bigint {
    if (level === 0) {
      return index < leaves.length ? leaves[index] : 0n;
    }
    const levelWidth = 2 ** level;
    const leafStart = index * levelWidth;
    if (leafStart >= leaves.length) {
      return zeros[level];
    }
    const left = nodeHash(level - 1, index * 2);
    const right = nodeHash(level - 1, index * 2 + 1);
    return poseidon2(left, right);
  }

  function emptyRoot(): bigint {
    return poseidon2(zeros[depth - 1], zeros[depth - 1]);
  }

  function root(): bigint {
    return leaves.length === 0 ? emptyRoot() : nodeHash(depth, 0);
  }

  function proofForLeaf(leafIndex: number): { root: string; siblings: string[]; pathIndices: number[] } {
    const siblings: string[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex;
    for (let level = 0; level < depth; level++) {
      const isRight = idx % 2 === 1;
      const siblingIndex = isRight ? idx - 1 : idx + 1;
      siblings.push(toHex32(nodeHash(level, siblingIndex)));
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { root: toHex32(root()), siblings, pathIndices };
  }

  return { insert, proofForLeaf, root, leafCount: () => leaves.length, leaves: () => leaves.slice(), zeros };
}

export type MerkleTreeInstance = ReturnType<typeof createMerkleTree>;

export function toHex32(value: bigint): string {
  if (value < 0n) throw new Error("toHex32: negative value");
  return "0x" + value.toString(16).padStart(64, "0");
}

export function fromHex(value: string): bigint {
  return BigInt(value);
}

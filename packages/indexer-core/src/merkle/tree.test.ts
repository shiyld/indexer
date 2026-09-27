import { createMerkleTree, toHex32, fromHex } from "./tree";
import { getPoseidon } from "./poseidon";

/** The strongest possible check for a Merkle implementation: don't just trust the
 * code, recompute the root from leaf+siblings+pathIndices bottom-up and confirm it
 * matches — mathematically self-verifying, independent of createMerkleTree's own
 * internals. */
function verifyProof(
  poseidon2: (a: bigint, b: bigint) => bigint,
  leaf: bigint,
  siblings: string[],
  pathIndices: number[],
  expectedRoot: string,
): boolean {
  let node = leaf;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = fromHex(siblings[i]);
    node = pathIndices[i] === 1 ? poseidon2(sibling, node) : poseidon2(node, sibling);
  }
  return toHex32(node) === expectedRoot;
}

describe("createMerkleTree (real Poseidon)", () => {
  let poseidon2: (a: bigint, b: bigint) => bigint;

  beforeAll(async () => {
    ({ poseidon2 } = await getPoseidon());
  });

  it("computes a stable, non-zero empty root for a genuinely empty tree", () => {
    const tree = createMerkleTree(poseidon2, 20);
    expect(tree.root()).not.toBe(0n);
    expect(tree.leafCount()).toBe(0);
  });

  it("produces a proof for a single inserted leaf that verifies against its own root", () => {
    const tree = createMerkleTree(poseidon2, 20);
    const leaf = 12345n;
    tree.insert(leaf);
    const proof = tree.proofForLeaf(0);

    expect(proof.siblings).toHaveLength(20);
    expect(proof.pathIndices).toHaveLength(20);
    expect(verifyProof(poseidon2, leaf, proof.siblings, proof.pathIndices, proof.root)).toBe(true);
    expect(proof.root).toBe(toHex32(tree.root()));
  });

  it("produces independently-verifiable proofs for every leaf across several insertions", () => {
    const tree = createMerkleTree(poseidon2, 20);
    const leaves = [11n, 22n, 33n, 44n, 55n];
    leaves.forEach((l) => tree.insert(l));

    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.proofForLeaf(i);
      expect(verifyProof(poseidon2, leaves[i], proof.siblings, proof.pathIndices, proof.root)).toBe(true);
    }
  });

  it("keeps an earlier leaf's proof verifiable against the NEW root after later leaves are inserted", () => {
    const tree = createMerkleTree(poseidon2, 20);
    tree.insert(1n);
    const rootAfterOne = tree.root();
    tree.insert(2n);
    const rootAfterTwo = tree.root();

    expect(rootAfterOne).not.toBe(rootAfterTwo);

    // Leaf 0's sibling at level 0 changes from a zero-value placeholder to the
    // real leaf 1 once it's inserted — the proof must reflect that, not the stale
    // sibling from before leaf 1 existed.
    const proof = tree.proofForLeaf(0);
    expect(verifyProof(poseidon2, 1n, proof.siblings, proof.pathIndices, proof.root)).toBe(true);
    expect(proof.root).toBe(toHex32(rootAfterTwo));
  });
});

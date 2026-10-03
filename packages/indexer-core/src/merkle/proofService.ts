import type { Pool as PgPool } from "pg";
import { createMerkleTree, toHex32 } from "./tree";
import { getPoseidon } from "./poseidon";
import { MERKLE_TREE_DEPTH } from "../schema/merkleProof";
import type { MerkleProofResponse } from "../schema/merkleProof";

export class LeafNotFoundError extends Error {
  constructor(poolAddress: string, leafIndex: number, treeSize: number) {
    super(`Leaf ${leafIndex} does not exist for pool ${poolAddress} — only ${treeSize} leaves have been inserted so far`);
    this.name = "LeafNotFoundError";
  }
}

/** A gap in the stored leaf sequence (e.g. leaf 3 present, leaf 4 missing) means a
 * LeafInserted event was never persisted — a real indexer bug, not something to
 * paper over by silently misplacing every later leaf into the wrong tree position. */
export class MerkleLeafGapError extends Error {
  constructor(poolAddress: string, expectedIndex: number, actualIndex: number) {
    super(
      `Merkle leaf sequence gap for pool ${poolAddress}: expected leaf_index ${expectedIndex} but found ${actualIndex} — ` +
        `a LeafInserted event was likely missed during ingestion. Do not trust proofs from this pool until resolved.`,
    );
    this.name = "MerkleLeafGapError";
  }
}

/**
 * Reconstructs a pool's Merkle tree from its stored leaves and computes a proof
 * for one leaf index. A stateless, from-scratch rebuild every call — item #8's
 * cache layer (keyed by (poolAddress, leafIndex, treeSize) per the design in
 * CLAUDE.md) is where repeat calls get accelerated, not here. Uses the exact same
 * algorithm, zero-value convention, and Poseidon(2) hashing already proven correct
 * against the real MerkleTree.sol.
 */
export async function computeMerkleProof(
  db: PgPool,
  chainId: number,
  poolAddress: string,
  leafIndex: number,
): Promise<MerkleProofResponse> {
  const { rows } = await db.query<{ leaf_index: string | number; leaf: string }>(
    `SELECT leaf_index, leaf FROM merkle_leaves WHERE chain_id = $1 AND pool_address = $2 ORDER BY leaf_index`,
    [chainId, poolAddress],
  );

  // leaf_index is BIGINT, which pg returns as a string.
  rows.forEach((row, i) => {
    const index = Number(row.leaf_index);
    if (index !== i) throw new MerkleLeafGapError(poolAddress, i, index);
  });

  if (leafIndex < 0 || leafIndex >= rows.length) {
    throw new LeafNotFoundError(poolAddress, leafIndex, rows.length);
  }

  const { poseidon2 } = await getPoseidon();
  const tree = createMerkleTree(poseidon2, MERKLE_TREE_DEPTH);
  for (const row of rows) tree.insert(BigInt(row.leaf));

  const proof = tree.proofForLeaf(leafIndex);

  return {
    poolAddress,
    leafIndex,
    leaf: toHex32(BigInt(rows[leafIndex].leaf)),
    siblings: proof.siblings,
    pathIndices: proof.pathIndices as (0 | 1)[],
    root: proof.root,
    treeNumber: proof.treeNumber,
    treeSize: tree.leafCount(),
  };
}

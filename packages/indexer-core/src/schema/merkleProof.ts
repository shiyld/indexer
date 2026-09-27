import { z } from "zod";
import { AddressSchema, Bytes32Schema } from "./common";

/** MerkleTree.sol's tree depth — pinned here since a proof's shape is fixed by it. */
export const MERKLE_TREE_DEPTH = 20;

/**
 * GET /<network>/pools/:poolAddress/merkle-proof/:leafIndex — one depth-20 sibling
 * path, bottom-up, matching MerkleTree.sol's own incremental tree exactly.
 * `treeSize` is the leaf count this proof was computed against; a cached copy of
 * this response is only valid for that exact treeSize (see CLAUDE.md's caching
 * design — a later leaf insertion can change an earlier leaf's sibling path).
 */
export const MerkleProofResponseSchema = z.object({
  poolAddress: AddressSchema,
  leafIndex: z.number().int().nonnegative(),
  leaf: Bytes32Schema,
  siblings: z.array(Bytes32Schema).length(MERKLE_TREE_DEPTH),
  pathIndices: z.array(z.union([z.literal(0), z.literal(1)])).length(MERKLE_TREE_DEPTH),
  root: Bytes32Schema,
  treeSize: z.number().int().nonnegative(),
});
export type MerkleProofResponse = z.infer<typeof MerkleProofResponseSchema>;

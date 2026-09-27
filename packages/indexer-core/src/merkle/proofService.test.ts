import { Pool as PgPool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { computeMerkleProof, LeafNotFoundError, MerkleLeafGapError } from "./proofService";
import { createMerkleTree, toHex32 } from "./tree";
import { getPoseidon } from "./poseidon";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const CHAIN_ID = 84532;
const POOL = "0x1111111111111111111111111111111111111111";

async function insertLeaf(db: PgPool, index: number, leaf: bigint): Promise<void> {
  await db.query(`INSERT INTO merkle_leaves (chain_id, pool_address, leaf_index, leaf, block_number) VALUES ($1, $2, $3, $4, 100)`, [
    CHAIN_ID,
    POOL,
    index,
    toHex32(leaf),
  ]);
}

describeIfDb("computeMerkleProof (real Postgres, real Poseidon)", () => {
  let db: PgPool;
  let poseidon2: (a: bigint, b: bigint) => bigint;

  beforeAll(async () => {
    ({ poseidon2 } = await getPoseidon());
  });

  beforeEach(async () => {
    db = new PgPool({ connectionString: TEST_DATABASE_URL });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(db, defaultMigrationsDir());
  });

  afterEach(async () => {
    await db.end();
  });

  it("computes a proof that exactly matches an independently-built reference tree", async () => {
    const leaves = [10n, 20n, 30n, 40n];
    for (let i = 0; i < leaves.length; i++) await insertLeaf(db, i, leaves[i]);

    const proof = await computeMerkleProof(db, CHAIN_ID, POOL, 2);

    const reference = createMerkleTree(poseidon2, 20);
    leaves.forEach((l) => reference.insert(l));
    const referenceProof = reference.proofForLeaf(2);

    expect(proof.root).toBe(referenceProof.root);
    expect(proof.siblings).toEqual(referenceProof.siblings);
    expect(proof.pathIndices).toEqual(referenceProof.pathIndices);
    expect(proof.treeSize).toBe(4);
    expect(proof.leaf).toBe(toHex32(30n));
  });

  it("throws LeafNotFoundError for an index at or beyond the current tree size", async () => {
    await insertLeaf(db, 0, 1n);
    await expect(computeMerkleProof(db, CHAIN_ID, POOL, 1)).rejects.toThrow(LeafNotFoundError);
    await expect(computeMerkleProof(db, CHAIN_ID, POOL, 5)).rejects.toThrow(LeafNotFoundError);
  });

  it("throws MerkleLeafGapError rather than silently misplacing leaves when one is missing", async () => {
    await insertLeaf(db, 0, 1n);
    await insertLeaf(db, 2, 3n); // leaf_index 1 never inserted — simulates a missed event
    await expect(computeMerkleProof(db, CHAIN_ID, POOL, 0)).rejects.toThrow(MerkleLeafGapError);
  });
});

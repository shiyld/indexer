import { Pool as PgPool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { seedRegistryFromSharedConstants } from "../registry/seed";
import { createMemoryCache } from "./memoryCache";
import { getPoolsCached, getProtocolContractsCached, computeMerkleProofCached, merkleProofCacheKey } from "./cachedReads";
import { toHex32 } from "../merkle/tree";
import type { CacheAdapter } from "./adapter";

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

describeIfDb("cachedReads (real Postgres, real in-memory cache)", () => {
  let db: PgPool;
  let cache: CacheAdapter;

  beforeEach(async () => {
    db = new PgPool({ connectionString: TEST_DATABASE_URL });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(db, defaultMigrationsDir());
    await seedRegistryFromSharedConstants(db);
    cache = createMemoryCache();
  });

  afterEach(async () => {
    await db.end();
  });

  it("getPoolsCached: a cache hit returns identical data without hitting Postgres again", async () => {
    const first = await getPoolsCached(cache, db, CHAIN_ID);
    const querySpy = jest.spyOn(db, "query");

    const second = await getPoolsCached(cache, db, CHAIN_ID);

    expect(second).toEqual(first);
    expect(querySpy).not.toHaveBeenCalled();
    querySpy.mockRestore();
  });

  it("getPoolsCached: filtering by asset produces a distinct cache entry from the unfiltered call", async () => {
    const all = await getPoolsCached(cache, db, CHAIN_ID);
    const ethOnly = await getPoolsCached(cache, db, CHAIN_ID, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(ethOnly.length).toBe(1);
    expect(all.length).toBeGreaterThan(ethOnly.length);
  });

  it("getProtocolContractsCached: a cache hit avoids a second Postgres query", async () => {
    await getProtocolContractsCached(cache, db, CHAIN_ID);
    const querySpy = jest.spyOn(db, "query");
    await getProtocolContractsCached(cache, db, CHAIN_ID);
    expect(querySpy).not.toHaveBeenCalled();
    querySpy.mockRestore();
  });

  describe("computeMerkleProofCached", () => {
    it("caches by treeSize — a repeat call for the same tree never rebuilds it", async () => {
      await insertLeaf(db, 0, 10n);
      await insertLeaf(db, 1, 20n);

      const first = await computeMerkleProofCached(cache, db, CHAIN_ID, POOL, 0);
      // Only the cheap COUNT query should run on the second call — no merkle_leaves
      // SELECT, no tree rebuild.
      const querySpy = jest.spyOn(db, "query");
      const second = await computeMerkleProofCached(cache, db, CHAIN_ID, POOL, 0);

      expect(second).toEqual(first);
      const queriedTables = querySpy.mock.calls.map((c) => String(c[0]));
      expect(queriedTables.some((q) => q.includes("count(*)"))).toBe(true);
      expect(queriedTables.some((q) => q.includes("SELECT leaf_index, leaf"))).toBe(false);
      querySpy.mockRestore();
    });

    it("a later leaf insertion changes the cache key, so the proof is correctly recomputed, not served stale", async () => {
      await insertLeaf(db, 0, 10n);
      await insertLeaf(db, 1, 20n);
      const beforeGrowth = await computeMerkleProofCached(cache, db, CHAIN_ID, POOL, 0);

      await insertLeaf(db, 2, 30n); // tree grew — leaf 0's real sibling path can change

      const afterGrowth = await computeMerkleProofCached(cache, db, CHAIN_ID, POOL, 0);

      expect(afterGrowth.treeSize).toBe(3);
      expect(beforeGrowth.treeSize).toBe(2);
      // Confirmed via distinct cache keys, not just distinct treeSize fields:
      expect(merkleProofCacheKey(CHAIN_ID, POOL, 0, 2)).not.toBe(merkleProofCacheKey(CHAIN_ID, POOL, 0, 3));
    });
  });
});

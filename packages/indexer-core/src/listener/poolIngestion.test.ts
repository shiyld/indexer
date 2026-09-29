import { Pool as PgPool } from "pg";
import type { EventLog } from "ethers";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { ingestPool } from "./poolIngestion";
import type { PoolChainClient } from "./chainClient";
import type { Pool as PoolRecord } from "../schema/pools";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const HASH_A = "0x" + "aa".repeat(32);
const HASH_B = "0x" + "bb".repeat(32);
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 84532;
const POOL_ADDRESS = "0x1111111111111111111111111111111111111111";
const ASSET = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DEPLOYMENT_BLOCK = 1000;

const TEST_POOL: PoolRecord = {
  chainId: CHAIN_ID,
  asset: ASSET,
  poolAddress: POOL_ADDRESS,
  version: "v1",
  deploymentBlock: DEPLOYMENT_BLOCK,
  verifiers: { deposit: RECIPIENT, transfer: RECIPIENT, withdraw: RECIPIENT },
  circuitArtifactHash: null,
  isCurrent: true,
  supersededByPoolAddress: null,
  supports2Input: false,
  supportsDepositCiphertext: false,
  supportsFeeEnforcement: false,
};

function depositLog(blockNumber: number, logIndex: number, leafIndex: number, amount: bigint): EventLog {
  return { eventName: "Deposit", args: { commitment: HASH_A, leafIndex: BigInt(leafIndex), amount, envelope: "0x01" }, blockNumber, transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`, index: logIndex } as unknown as EventLog;
}

function leafInsertedLog(blockNumber: number, logIndex: number, leafIndex: number, root: string): EventLog {
  return { eventName: "LeafInserted", args: { leafIndex: BigInt(leafIndex), leaf: HASH_A, root }, blockNumber, transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`, index: logIndex } as unknown as EventLog;
}

/** A fake PoolChainClient — canned events per exact (fromBlock,toBlock) range,
 * so tests can assert both the parsing/persistence logic AND the exact chunk
 * boundaries ingestPool actually requests, without touching a real chain. */
function makeFakeClient(
  eventsByRange: Map<string, EventLog[]>,
  root: string,
): { client: PoolChainClient; calls: Array<[number, number]>; rootReads: number[] } {
  const calls: Array<[number, number]> = [];
  const rootReads: number[] = [];
  const client: PoolChainClient = {
    async getEventsInRange(fromBlock, toBlock) {
      calls.push([fromBlock, toBlock]);
      return eventsByRange.get(`${fromBlock}-${toBlock}`) ?? [];
    },
    async getRootAt(blockTag) {
      rootReads.push(blockTag);
      return root;
    },
    async getBalance() {
      return 123n;
    },
  };
  return { client, calls, rootReads };
}

describeIfDb("ingestPool (real Postgres, fake chain client)", () => {
  let db: PgPool;

  beforeEach(async () => {
    db = new PgPool({ connectionString: TEST_DATABASE_URL });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(db, defaultMigrationsDir());
  });

  afterEach(async () => {
    await db.end();
  });

  it("backfills from the pool's deploymentBlock on a genuinely first-ever run", async () => {
    const events = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [depositLog(1200, 0, 0, 10n), leafInsertedLog(1200, 1, 0, HASH_B)]]]);
    const { client } = makeFakeClient(events, HASH_B);

    const result = await ingestPool(db, client, TEST_POOL, 1500);

    expect(result.fromBlock).toBe(DEPLOYMENT_BLOCK);
    expect(result.eventsProcessed).toBe(2);
    expect(result.rootSanityCheck).toBe("ok");

    const { rows: eventRows } = await db.query("SELECT event_type FROM events ORDER BY id");
    expect(eventRows.map((r) => r.event_type)).toEqual(["Deposit", "LeafInserted"]);

    const { rows: leafRows } = await db.query("SELECT leaf_index, leaf FROM merkle_leaves");
    expect(leafRows).toEqual([{ leaf_index: 0, leaf: HASH_A }]);

    const { rows: statRows } = await db.query("SELECT deposit_count, leaf_count, current_balance FROM pool_stats");
    expect(statRows[0]).toMatchObject({ deposit_count: "1", leaf_count: "1", current_balance: "123" });

    const { rows: cursorRows } = await db.query("SELECT last_processed_block FROM ingestion_cursor");
    expect(cursorRows[0].last_processed_block).toBe("1500");
  });

  it("resumes from the saved cursor on a second run, never re-scanning already-processed blocks", async () => {
    const firstEvents = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [depositLog(1200, 0, 0, 10n)]]]);
    const { client: firstClient } = makeFakeClient(firstEvents, HASH_A);
    await ingestPool(db, firstClient, TEST_POOL, 1500);

    const secondEvents = new Map([[`1501-2000`, [depositLog(1800, 0, 1, 20n)]]]);
    const { client: secondClient, calls } = makeFakeClient(secondEvents, HASH_A);
    const result = await ingestPool(db, secondClient, TEST_POOL, 2000);

    expect(result.fromBlock).toBe(1501); // resumed from cursor+1, not deploymentBlock again
    expect(calls).toEqual([[1501, 2000]]);
    expect(result.eventsProcessed).toBe(1);

    const { rows } = await db.query("SELECT count(*) FROM events");
    expect(rows[0].count).toBe("2"); // both runs' events retained
  });

  it("returns 'skipped' with zero events when there is genuinely nothing new past the cursor", async () => {
    const { client } = makeFakeClient(new Map(), HASH_A);
    await ingestPool(db, client, TEST_POOL, 1500);

    const { client: secondClient, calls } = makeFakeClient(new Map(), HASH_A);
    const result = await ingestPool(db, secondClient, TEST_POOL, 1500); // same head again

    expect(result.eventsProcessed).toBe(0);
    expect(result.rootSanityCheck).toBe("skipped");
    expect(calls).toEqual([]); // never even asked the chain for events in an empty range
  });

  it("flags a real root mismatch rather than silently trusting a wrong root", async () => {
    const events = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [leafInsertedLog(1200, 0, 0, HASH_A)]]]);
    const { client } = makeFakeClient(events, HASH_B); // on-chain root() disagrees with the event's own root

    const result = await ingestPool(db, client, TEST_POOL, 1500);

    expect(result.rootSanityCheck).toBe("mismatch");
    // A mismatch is reported, not thrown — fault isolation means one bad pool
    // never crashes the caller's loop.
  });

  it("reads the on-chain root at head, not at the leaf's own (possibly pruned) block", async () => {
    const events = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [leafInsertedLog(1200, 0, 0, HASH_A)]]]);
    const { client, rootReads } = makeFakeClient(events, HASH_A);

    const result = await ingestPool(db, client, TEST_POOL, 1500);

    expect(result.rootSanityCheck).toBe("ok");
    expect(rootReads).toEqual([1500]);
  });

  it("chunks a range larger than the 1,000-block limit into multiple requests", async () => {
    const { client, calls } = makeFakeClient(new Map(), HASH_A);
    await ingestPool(db, client, TEST_POOL, DEPLOYMENT_BLOCK + 2_500);

    expect(calls).toEqual([
      [DEPLOYMENT_BLOCK, DEPLOYMENT_BLOCK + 999],
      [DEPLOYMENT_BLOCK + 1_000, DEPLOYMENT_BLOCK + 1_999],
      [DEPLOYMENT_BLOCK + 2_000, DEPLOYMENT_BLOCK + 2_500],
    ]);
  });

  it("is idempotent at the storage layer — re-processing the same event twice never duplicates a row", async () => {
    const events = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [depositLog(1200, 0, 0, 10n)]]]);
    const { client } = makeFakeClient(events, HASH_A);
    await ingestPool(db, client, TEST_POOL, 1500);

    // Manually re-insert the identical event's underlying row via the same unique
    // key it would collide on, simulating a reprocessed chunk (e.g. after a crash
    // mid-cycle, before the cursor advanced).
    await db.query(
      `INSERT INTO events (chain_id, pool_address, event_type, block_number, transaction_hash, log_index, data)
       SELECT chain_id, pool_address, event_type, block_number, transaction_hash, log_index, data FROM events
       ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    );

    const { rows } = await db.query("SELECT count(*) FROM events");
    expect(rows[0].count).toBe("1");
  });

  describe("realtime emitter wiring", () => {
    it("never emits during a pool's genuinely first-ever backfill, even though real events were found", async () => {
      const events = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [depositLog(1200, 0, 0, 10n)]]]);
      const { client } = makeFakeClient(events, HASH_A);
      const emitPoolEvent = jest.fn();

      await ingestPool(db, client, TEST_POOL, 1500, { emitPoolEvent });

      expect(emitPoolEvent).not.toHaveBeenCalled();
    });

    it("emits real events found on a normal poll cycle, once the pool is already synced", async () => {
      const firstEvents = new Map([[`${DEPLOYMENT_BLOCK}-1500`, [depositLog(1200, 0, 0, 10n)]]]);
      const { client: firstClient } = makeFakeClient(firstEvents, HASH_A);
      await ingestPool(db, firstClient, TEST_POOL, 1500); // establishes a cursor — this pool is no longer "first-ever"

      const secondEvents = new Map([[`1501-2000`, [depositLog(1800, 0, 1, 20n)]]]);
      const { client: secondClient } = makeFakeClient(secondEvents, HASH_A);
      const emitPoolEvent = jest.fn();

      await ingestPool(db, secondClient, TEST_POOL, 2000, { emitPoolEvent });

      expect(emitPoolEvent).toHaveBeenCalledTimes(1);
      // TEST_POOL.chainId is the real Base Sepolia chain ID — resolves to its
      // real registry slug, not a fake/placeholder value.
      expect(emitPoolEvent).toHaveBeenCalledWith("base-sepolia", POOL_ADDRESS, expect.objectContaining({ type: "Deposit", amount: "20" }));
    });
  });
});

import { Pool as PgPool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { NetworkListener } from "./networkListener";
import type { PoolChainClient } from "./chainClient";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const CHAIN_ID = 84532;
const GOOD_POOL = "0x1111111111111111111111111111111111111111";
const BAD_POOL = "0x2222222222222222222222222222222222222222";

async function insertPool(db: PgPool, poolAddress: string): Promise<void> {
  await db.query(
    `INSERT INTO pools (chain_id, pool_address, asset, version, deployment_block, deposit_verifier, transfer_verifier, withdraw_verifier, is_current, superseded_by_pool_address)
     VALUES ($1, $2, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'v1', 100, $3, $3, $3, true, NULL)`,
    [CHAIN_ID, poolAddress, "0x3333333333333333333333333333333333333333"],
  );
}

function fakeClient(shouldThrow = false): PoolChainClient {
  return {
    async getEventsInRange() {
      if (shouldThrow) throw new Error("simulated RPC failure for this pool");
      return [];
    },
    async getRootAt() {
      return "0x" + "00".repeat(32);
    },
    async getBalance() {
      return 0n;
    },
  };
}

describeIfDb("NetworkListener (real Postgres, fake chain access)", () => {
  let db: PgPool;
  let listener: NetworkListener | null = null;

  beforeEach(async () => {
    db = new PgPool({ connectionString: TEST_DATABASE_URL });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(db, defaultMigrationsDir());
  });

  afterEach(async () => {
    listener?.stop();
    listener = null;
    await db.end();
  });

  it("reports 'synced' immediately when no pools are registered for this chain yet", async () => {
    listener = new NetworkListener({
      chainId: CHAIN_ID,
      db,
      getBlockNumber: async () => 500,
      createChainClient: () => fakeClient(),
      pollIntervalMs: 60_000,
    });
    await listener.start();

    expect(listener.getStatus()).toMatchObject({ chainId: CHAIN_ID, state: "synced", chainHeadBlock: 500 });
  });

  it("ingests every registered pool and reports 'synced' when everything succeeds", async () => {
    await insertPool(db, GOOD_POOL);
    listener = new NetworkListener({
      chainId: CHAIN_ID,
      db,
      getBlockNumber: async () => 500,
      createChainClient: () => fakeClient(),
      pollIntervalMs: 60_000,
    });
    await listener.start();

    expect(listener.getStatus()).toMatchObject({ state: "synced", lastProcessedBlock: 500, blocksBehind: 0 });
    const { rows } = await db.query("SELECT * FROM ingestion_cursor WHERE address = $1", [GOOD_POOL]);
    expect(rows).toHaveLength(1);
  });

  it("isolates a failing pool — one pool's ingestion error doesn't stop another pool in the same cycle", async () => {
    await insertPool(db, GOOD_POOL);
    await insertPool(db, BAD_POOL);
    listener = new NetworkListener({
      chainId: CHAIN_ID,
      db,
      getBlockNumber: async () => 500,
      createChainClient: (poolAddress) => fakeClient(poolAddress === BAD_POOL),
      pollIntervalMs: 60_000,
    });
    await listener.start();

    // The failing pool degrades overall status...
    expect(listener.getStatus().state).toBe("degraded");
    // ...but the good pool was still fully processed in the same cycle.
    const { rows } = await db.query("SELECT * FROM ingestion_cursor WHERE address = $1", [GOOD_POOL]);
    expect(rows).toHaveLength(1);
  });

  it("marks the network 'down' on a total RPC outage, without throwing out of start()", async () => {
    listener = new NetworkListener({
      chainId: CHAIN_ID,
      db,
      getBlockNumber: async () => {
        throw new Error("connection refused");
      },
      createChainClient: () => fakeClient(),
      pollIntervalMs: 60_000,
    });

    // start() must resolve even when the very first poll fails — a rejecting
    // start() is exactly the bug found live 2026-09-14 (see the doc comment on
    // NetworkListener.start()): MultiNetworkListener only logs a start()
    // rejection and never retries it, so a network stuck rejecting here is
    // permanently "down" for the life of the process with no self-healing, even
    // once the underlying outage resolves.
    await expect(listener.start()).resolves.toBeUndefined();
    expect(listener.getStatus().state).toBe("down");
  });

  it("self-heals: a network that fails its very first poll recovers once a later poll succeeds", async () => {
    let shouldFail = true;
    listener = new NetworkListener({
      chainId: CHAIN_ID,
      db,
      getBlockNumber: async () => {
        if (shouldFail) throw new Error("connection refused");
        return 500;
      },
      createChainClient: () => fakeClient(),
      pollIntervalMs: 20,
    });

    await listener.start();
    expect(listener.getStatus().state).toBe("down");

    // The underlying outage resolves sometime later — the interval set up by
    // start() (not blocked by the failed initial poll) is what picks this back
    // up with no restart required.
    shouldFail = false;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(listener.getStatus()).toMatchObject({ state: "synced", chainHeadBlock: 500 });
  });

  it("stop() halts the polling timer — no further ingestion after stop", async () => {
    await insertPool(db, GOOD_POOL);
    let callCount = 0;
    listener = new NetworkListener({
      chainId: CHAIN_ID,
      db,
      getBlockNumber: async () => {
        callCount++;
        return 500;
      },
      createChainClient: () => fakeClient(),
      pollIntervalMs: 20,
    });
    await listener.start();
    listener.stop();
    const countAtStop = callCount;

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(callCount).toBe(countAtStop);
  });
});

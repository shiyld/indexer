import { Pool as PgPool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { saveNetworkStatus, getPersistedNetworkStatuses } from "./networkStatusStore";
import type { NetworkListenerStatus } from "./networkListener";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

function status(overrides: Partial<NetworkListenerStatus> = {}): NetworkListenerStatus {
  return { chainId: 84532, state: "synced", lastProcessedBlock: 100, chainHeadBlock: 100, blocksBehind: 0, ...overrides };
}

describeIfDb("networkStatusStore (real Postgres)", () => {
  let db: PgPool;

  beforeEach(async () => {
    db = new PgPool({ connectionString: TEST_DATABASE_URL });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(db, defaultMigrationsDir());
  });

  afterEach(async () => {
    await db.end();
  });

  it("round-trips a saved status", async () => {
    await saveNetworkStatus(db, status({ state: "syncing", blocksBehind: 500 }));
    const [read] = await getPersistedNetworkStatuses(db, [84532]);
    expect(read).toMatchObject({ chainId: 84532, state: "syncing", blocksBehind: 500 });
  });

  it("upserts — saving again for the same chain updates the row, never duplicates it", async () => {
    await saveNetworkStatus(db, status({ state: "syncing" }));
    await saveNetworkStatus(db, status({ state: "synced" }));
    const results = await getPersistedNetworkStatuses(db, [84532]);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("synced");
  });

  it("returns an empty list for a chain with no persisted status yet", async () => {
    const results = await getPersistedNetworkStatuses(db, [999999]);
    expect(results).toEqual([]);
  });

  it("reports a stale row as 'down', regardless of its own stored state — a crashed worker must be visible", async () => {
    await saveNetworkStatus(db, status({ state: "synced" }));
    // Backdate updated_at past the staleness threshold, simulating a worker that
    // stopped persisting status (e.g. it crashed) a while ago.
    await db.query(`UPDATE network_status SET updated_at = now() - interval '5 minutes' WHERE chain_id = 84532`);

    const [read] = await getPersistedNetworkStatuses(db, [84532]);
    expect(read.state).toBe("down");
  });
});

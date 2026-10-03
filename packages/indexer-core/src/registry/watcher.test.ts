import { Pool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { seedRegistryFromSharedConstants } from "./seed";
import { RegistryWatcher } from "./watcher";

/** Real integration test against a live Postgres — same convention as the other
 * registry tests. */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("RegistryWatcher (real Postgres, real polling)", () => {
  let pool: Pool;
  let watcher: RegistryWatcher | null = null;

  beforeEach(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(pool, defaultMigrationsDir());
    await seedRegistryFromSharedConstants(pool);
  });

  afterEach(async () => {
    // Always stop the watcher — an un-cleared setInterval would keep the process
    // (and this test file) alive after the suite finishes, the exact "open handle"
    // class of bug already documented elsewhere in this project.
    watcher?.stop();
    watcher = null;
    await pool.end();
  });

  it("loads the seeded registry immediately on start()", async () => {
    watcher = new RegistryWatcher(pool, [84532]);
    const snapshot = await watcher.start();
    expect(snapshot.pools.length).toBeGreaterThanOrEqual(11);
    expect(snapshot.contracts.length).toBe(9); // core 4 + Staking, StakingParameters, EmissionSchedule, Treasury, SydWethPair
  });

  it("picks up a newly-registered pool on the next poll, without a restart, and fires onChange", async () => {
    const onChange = jest.fn();
    watcher = new RegistryWatcher(pool, [84532], { pollIntervalMs: 50, onChange });
    const initial = await watcher.start();
    const initialCount = initial.pools.length;

    // Simulate exactly what "deploy-script auto-registration" will do later: insert
    // a brand-new pool row directly, as if a fresh version had just been deployed.
    await pool.query(
      `INSERT INTO pools (chain_id, pool_address, asset, version, deployment_block, deposit_verifier, transfer_verifier, withdraw_verifier, is_current, superseded_by_pool_address)
       VALUES (84532, '0x1111111111111111111111111111111111111111', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'v2', 99999999, '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333', '0x4444444444444444444444444444444444444444', true, NULL)`,
    );

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(onChange).toHaveBeenCalled();
    const latest = watcher.getSnapshot();
    expect(latest.pools.length).toBe(initialCount + 1);
    expect(latest.pools.some((p) => p.poolAddress === "0x1111111111111111111111111111111111111111")).toBe(true);
  });

  it("does not fire onChange when nothing has actually changed between polls", async () => {
    const onChange = jest.fn();
    watcher = new RegistryWatcher(pool, [84532], { pollIntervalMs: 50, onChange });
    await watcher.start();

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("stop() actually halts polling — no further onChange after stop, even if data changes", async () => {
    const onChange = jest.fn();
    watcher = new RegistryWatcher(pool, [84532], { pollIntervalMs: 50, onChange });
    await watcher.start();
    watcher.stop();

    await pool.query(
      `INSERT INTO pools (chain_id, pool_address, asset, version, deployment_block, deposit_verifier, transfer_verifier, withdraw_verifier, is_current, superseded_by_pool_address)
       VALUES (84532, '0x5555555555555555555555555555555555555555', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'v3', 100000000, '0x6666666666666666666666666666666666666666', '0x7777777777777777777777777777777777777777', '0x8888888888888888888888888888888888888888', true, NULL)`,
    );

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(onChange).not.toHaveBeenCalled();
  });
});

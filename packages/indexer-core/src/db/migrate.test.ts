import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { runMigrations, defaultMigrationsDir } from "./migrate";

/**
 * Real integration test against a live Postgres — this project's established
 * convention for RPC/DB-adjacent code (see CLAUDE.md: "wallet-core's scanner.ts has
 * never been Jest-unit-tested either... verified via a direct live call"). Targets
 * an isolated `indexer_core_test` database on the shared dev Postgres container —
 * never the real `shiyld` database apps/api/apps/api-worker are using.
 *
 * Requires TEST_DATABASE_URL to be set; skips (not fails) otherwise, so this suite
 * doesn't break `pnpm run test` for anyone without a local Postgres reachable.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("runMigrations (real Postgres)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    // Start every test from a clean slate — drop anything a prior run left behind.
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });

  afterEach(async () => {
    await pool.end();
  });

  it("applies every real migration and creates every designed table", async () => {
    // Deliberately not hardcoded to an exact file list — this suite should keep
    // passing as real migrations are added over time; it asserts the *outcome*
    // (every designed table exists) rather than today's specific file count.
    const applied = await runMigrations(pool, defaultMigrationsDir());
    expect(applied.length).toBeGreaterThan(0);
    expect(applied).toEqual([...applied].sort());

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tableNames = rows.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "pools",
        "protocol_contracts",
        "ingestion_cursor",
        "events",
        "merkle_leaves",
        "pool_stats",
        "stats_history",
        "network_status",
      ]),
    );
  });

  it("running it again is a no-op — already-applied migrations aren't re-run", async () => {
    await runMigrations(pool, defaultMigrationsDir());
    const secondRun = await runMigrations(pool, defaultMigrationsDir());
    expect(secondRun).toEqual([]);
  });

  it("a genuinely new migration file gets picked up without re-running the first one", async () => {
    await runMigrations(pool, defaultMigrationsDir());

    // Simulate a future schema change by adding a second migration in a temp dir
    // that also contains a copy of the real 0001 (runMigrations reads the whole
    // directory), proving it correctly skips the already-applied one.
    const tmp = mkdtempSync(join(tmpdir(), "indexer-core-migrations-"));
    writeFileSync(join(tmp, "0001_init.sql"), "-- already applied, must be skipped, this would error if re-run\nSELECT 1/0;");
    writeFileSync(join(tmp, "0002_add_note_column.sql"), "ALTER TABLE pools ADD COLUMN note TEXT;");

    const applied = await runMigrations(pool, tmp);
    expect(applied).toEqual(["0002_add_note_column.sql"]);

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'pools' AND column_name = 'note'`,
    );
    expect(rows).toHaveLength(1);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("recovers from apps/api's old pre-migration schema (ingestion_cursor/pool_stats/stats_history already exist, schema_migrations empty) — the exact drift found live on Base Sepolia staging 2026-09-21", async () => {
    // Simulate apps/api's old bespoke SCHEMA_SQL having already created these three
    // tables before indexer-core's migration tracking existed — including the real
    // column-name mismatch (pool_address, not address) that broke ingestion_cursor.
    await pool.query(`
      CREATE TABLE ingestion_cursor (
        chain_id INTEGER NOT NULL,
        pool_address TEXT NOT NULL,
        last_processed_block BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (chain_id, pool_address)
      );
      CREATE TABLE pool_stats (
        chain_id INTEGER NOT NULL,
        pool_address TEXT NOT NULL,
        asset_symbol TEXT,
        deposit_count BIGINT NOT NULL DEFAULT 0,
        transfer_count BIGINT NOT NULL DEFAULT 0,
        withdraw_count BIGINT NOT NULL DEFAULT 0,
        leaf_count BIGINT NOT NULL DEFAULT 0,
        current_balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (chain_id, pool_address)
      );
      CREATE TABLE stats_history (
        id BIGSERIAL PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        pool_address TEXT NOT NULL,
        deposit_count BIGINT NOT NULL,
        transfer_count BIGINT NOT NULL,
        withdraw_count BIGINT NOT NULL,
        leaf_count BIGINT NOT NULL,
        current_balance NUMERIC(78, 0) NOT NULL,
        snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Must not throw — this is exactly what stayed broken in a loop for 3+ days
    // in production before this fix.
    const applied = await runMigrations(pool, defaultMigrationsDir());
    expect(applied.length).toBeGreaterThan(0);

    // The genuinely missing tables got created despite the pre-existing three.
    const { rows: tables } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["pools", "protocol_contracts", "events", "merkle_leaves", "network_status"]),
    );

    // The real point of this test: ingestion_cursor's column got renamed, and the
    // exact query listener/poolIngestion.ts runs against it now works.
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ingestion_cursor'`,
    );
    const columnNames = cols.map((r) => r.column_name);
    expect(columnNames).toContain("address");
    expect(columnNames).not.toContain("pool_address");
    await expect(
      pool.query(`SELECT last_processed_block FROM ingestion_cursor WHERE chain_id = $1 AND address = $2`, [1, "0x0"]),
    ).resolves.toBeDefined();

    // Running it all again is still a clean no-op — this drift-recovery path
    // doesn't reintroduce the "not idempotent after the first real run" problem.
    const secondRun = await runMigrations(pool, defaultMigrationsDir());
    expect(secondRun).toEqual([]);
  });

  it("rolls back a failing migration entirely — a bad statement leaves no partial schema behind", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "indexer-core-migrations-fail-"));
    writeFileSync(
      join(tmp, "0001_broken.sql"),
      `CREATE TABLE will_be_rolled_back (id INT);\nSELECT this_function_does_not_exist();`,
    );

    await expect(runMigrations(pool, tmp)).rejects.toThrow(/0001_broken\.sql/);

    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'will_be_rolled_back') AS exists`,
    );
    expect(rows[0].exists).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  });
});

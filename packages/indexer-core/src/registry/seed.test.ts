import { Pool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { seedRegistryFromSharedConstants } from "./seed";
import { getPools, getProtocolContracts } from "./read";

/** Real integration test against a live Postgres — same convention and the same
 * isolated `indexer_core_test` database as db/migrate.test.ts. */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("seedRegistryFromSharedConstants (real Postgres + real @shiyld/shared data)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(pool, defaultMigrationsDir());
  });

  afterEach(async () => {
    await pool.end();
  });

  it("seeds every currently-deployed Base Sepolia pool with real, correct addresses", async () => {
    const result = await seedRegistryFromSharedConstants(pool);
    expect(result.poolsSeeded).toBeGreaterThanOrEqual(11); // ETH/USDT/USDC/DAI/BTC/XAU/XAG/AAPL/MSFT/AMZN/NVDA

    const pools = await getPools(pool, 84532);
    const eth = pools.find((p) => p.asset === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(eth).toBeDefined();
    expect(eth?.poolAddress).toBe("0xc41106C1051cFC48380C9936cD99f28DcE636080");
    expect(eth?.verifiers.deposit).toBe("0xc4a091829E5DeE786fea9cCF51585ab816Def6ac");
    expect(eth?.isCurrent).toBe(true);
    expect(eth?.supportsFeeEnforcement).toBe(true);
    // Never fabricated — see the migration's own comment on this column.
    expect(eth?.circuitArtifactHash).toBeNull();
  });

  it("seeds PoolFactory/EpochManager/ParameterRegistry/TestSYD as protocol contracts", async () => {
    await seedRegistryFromSharedConstants(pool);
    const contracts = await getProtocolContracts(pool, 84532);
    const kinds = contracts.map((c) => c.kind).sort();
    expect(kinds).toEqual(["EpochManager", "ParameterRegistry", "PoolFactory", "TestSYD"]);
  });

  it("registers each sidechain's pools under its own chainId, despite identical addresses", async () => {
    await seedRegistryFromSharedConstants(pool);
    const base = await getPools(pool, 84532);
    const arbitrum = await getPools(pool, 421614);
    const ethereum = await getPools(pool, 11155111);

    expect(arbitrum).toHaveLength(base.length);
    expect(ethereum).toHaveLength(base.length);
    const addresses = (pools: typeof base) => pools.map((p) => p.poolAddress.toLowerCase()).sort();
    expect(addresses(arbitrum)).toEqual(addresses(base));
    expect(arbitrum.every((p) => p.chainId === 421614)).toBe(true);
  });

  it("is idempotent — re-running produces the same row counts, not duplicates", async () => {
    const first = await seedRegistryFromSharedConstants(pool);
    const second = await seedRegistryFromSharedConstants(pool);
    expect(second.poolsSeeded).toBe(first.poolsSeeded);
    expect(second.contractsSeeded).toBe(first.contractsSeeded);

    const pools = await getPools(pool, 84532);
    const uniqueAddresses = new Set(pools.map((p) => p.poolAddress));
    expect(uniqueAddresses.size).toBe(pools.length);
  });
});

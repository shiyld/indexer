import { Pool } from "pg";
import { ASSETS } from "@shiyld/shared";
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
    expect(eth?.poolAddress).toBe("0x21565437890Ea3932077739ad88630d7008504b1");
    expect(eth?.verifiers.deposit).toBe("0x8eCC87BC1dD25e0676285fC41BAa781df4E5Aabd");
    expect(eth?.isCurrent).toBe(true);
    expect(eth?.supportsFeeEnforcement).toBe(true);
    // Never fabricated — see the migration's own comment on this column.
    expect(eth?.circuitArtifactHash).toBeNull();
  });

  it("marks pools and a factory replaced by a redeploy as superseded, and leaves newer pools alone", async () => {
    const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    const OLD_POOL = "0x1111111111111111111111111111111111111111";
    const NEWER_POOL = "0x5555555555555555555555555555555555555555";
    const OLD_FACTORY = "0x6666666666666666666666666666666666666666";
    const insertPool = (address: string, block: number) =>
      pool.query(
        `INSERT INTO pools (chain_id, pool_address, asset, version, deployment_block, deposit_verifier, transfer_verifier, withdraw_verifier, is_current, superseded_by_pool_address)
         VALUES (84532, $1, $2, 'v1', $3, '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333', '0x4444444444444444444444444444444444444444', true, NULL)`,
        [address, ETH, block],
      );
    // An older ETH pool from before a redeploy, and a newer one registered straight
    // into the database (as future deploy-script auto-registration would).
    await insertPool(OLD_POOL, 1);
    await insertPool(NEWER_POOL, 999_999_999);
    await pool.query(
      `INSERT INTO protocol_contracts (chain_id, address, kind, deployment_block, is_current, superseded_by_address)
       VALUES (84532, $1, 'PoolFactory', 1, true, NULL)`,
      [OLD_FACTORY],
    );

    await seedRegistryFromSharedConstants(pool);

    const pools = await getPools(pool, 84532);
    const byAddress = (a: string) => pools.find((p) => p.poolAddress === a);
    const currentEth = byAddress("0x21565437890Ea3932077739ad88630d7008504b1");
    expect(currentEth?.isCurrent).toBe(true);
    expect(byAddress(OLD_POOL)?.isCurrent).toBe(false);
    expect(byAddress(OLD_POOL)?.supersededByPoolAddress).toBe("0x21565437890Ea3932077739ad88630d7008504b1");
    expect(byAddress(NEWER_POOL)?.isCurrent).toBe(true);

    const contracts = await getProtocolContracts(pool, 84532);
    const oldFactory = contracts.find((c) => c.address === OLD_FACTORY);
    expect(oldFactory?.isCurrent).toBe(false);
    expect(oldFactory?.supersededByAddress).toBe("0xDd1b25114b63b43b65d8eEf2356395FabD2FaaB4");
  });

  it("seeds PoolFactory/EpochManager/ParameterRegistry/TestSYD as protocol contracts", async () => {
    await seedRegistryFromSharedConstants(pool);
    const contracts = await getProtocolContracts(pool, 84532);
    const kinds = contracts.map((c) => c.kind).sort();
    expect(kinds).toEqual(["EpochManager", "ParameterRegistry", "PoolFactory", "TestSYD"]);
  });

  it("registers each chain's pools under its own chainId, matching @shiyld/shared for that chain", async () => {
    await seedRegistryFromSharedConstants(pool);
    const addresses = (pools: { poolAddress: string }[]) => pools.map((p) => p.poolAddress.toLowerCase()).sort();
    for (const chainId of [84532, 421614, 11155111]) {
      const pools = await getPools(pool, chainId);
      const expected = Object.values(ASSETS[chainId])
        .map((a) => a.poolAddress)
        .filter((a): a is string => !!a);
      expect(pools).toHaveLength(11);
      expect(addresses(pools)).toEqual(addresses(expected.map((poolAddress) => ({ poolAddress }))));
      expect(pools.every((p) => p.chainId === chainId)).toBe(true);
    }
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

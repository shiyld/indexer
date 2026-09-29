import type { Pool as PgPool } from "pg";
import { ADDRESSES, ASSETS, TESTNET_SYD } from "@shiyld/shared";

export interface SeedResult {
  poolsSeeded: number;
  contractsSeeded: number;
}

/**
 * Bootstrap-seeds the `pools`/`protocol_contracts` registries from @shiyld/shared's
 * static constants — the canonical, zero-dependency source of truth this whole
 * project already uses elsewhere. This is what a fresh indexer instance (Shiyld's
 * own, or a third-party self-hosted one) needs to know which contracts to listen to
 * at all, before any deploy-script auto-registration exists (see CLAUDE.md's
 * "Indexer: Full Design & Public Distribution Plan"). Idempotent — safe to re-run
 * any number of times, upserting on each table's primary key rather than failing or
 * duplicating rows.
 */
export async function seedRegistryFromSharedConstants(pool: PgPool): Promise<SeedResult> {
  let poolsSeeded = 0;
  let contractsSeeded = 0;

  for (const chainIdKey of Object.keys(ASSETS)) {
    const chainId = Number(chainIdKey);
    const assetsForChain = ASSETS[chainId];
    const chainAddresses = ADDRESSES[chainId];

    for (const asset of Object.values(assetsForChain)) {
      // An asset with no poolAddress (e.g. Arbitrum/Ethereum Sepolia's placeholder
      // entries) has no ShieldedPool deployed yet — nothing to register.
      if (!asset.poolAddress || !chainAddresses) continue;

      await pool.query(
        `INSERT INTO pools (
           chain_id, pool_address, asset, version, deployment_block,
           deposit_verifier, transfer_verifier, withdraw_verifier,
           transfer2_verifier, withdraw2_verifier,
           is_current, superseded_by_pool_address,
           supports_two_input, supports_deposit_ciphertext, supports_fee_enforcement
         ) VALUES ($1,$2,$3,'v1',$4,$5,$6,$7,$8,$9,true,NULL,$10,$11,$12)
         ON CONFLICT (chain_id, pool_address) DO UPDATE SET
           asset = EXCLUDED.asset,
           deployment_block = EXCLUDED.deployment_block,
           deposit_verifier = EXCLUDED.deposit_verifier,
           transfer_verifier = EXCLUDED.transfer_verifier,
           withdraw_verifier = EXCLUDED.withdraw_verifier,
           transfer2_verifier = EXCLUDED.transfer2_verifier,
           withdraw2_verifier = EXCLUDED.withdraw2_verifier,
           supports_two_input = EXCLUDED.supports_two_input,
           supports_deposit_ciphertext = EXCLUDED.supports_deposit_ciphertext,
           supports_fee_enforcement = EXCLUDED.supports_fee_enforcement`,
        [
          chainId,
          asset.poolAddress,
          asset.address,
          asset.deploymentBlock ?? 0,
          chainAddresses.depositVerifier,
          chainAddresses.transferVerifier,
          chainAddresses.withdrawVerifier,
          chainAddresses.transfer2Verifier ?? null,
          chainAddresses.withdraw2Verifier ?? null,
          asset.supports2Input ?? false,
          asset.supportsDepositCiphertext ?? false,
          asset.supportsFeeEnforcement ?? false,
        ],
      );
      poolsSeeded++;
    }

    // A pool that was registered before but is no longer in @shiyld/shared has been
    // replaced by a redeploy (e.g. the 2026-09-29 soundness fix). Mark it superseded by
    // the current pool for the same asset, so /pools stops presenting it as current.
    // Only older pools: a newer one registered straight into the database (future
    // deploy-script auto-registration) must survive a restart-time reseed.
    const currentPools = Object.values(assetsForChain)
      .map((a) => a.poolAddress)
      .filter((a): a is string => !!a);
    if (currentPools.length > 0) {
      await pool.query(
        `UPDATE pools AS old
            SET is_current = false, superseded_by_pool_address = cur.pool_address
           FROM pools AS cur
          WHERE old.chain_id = $1 AND cur.chain_id = $1
            AND lower(old.asset) = lower(cur.asset)
            AND cur.pool_address = ANY($2::text[])
            AND NOT (old.pool_address = ANY($2::text[]))
            AND old.deployment_block < cur.deployment_block
            AND old.is_current`,
        [chainId, currentPools],
      );
    }

    if (chainAddresses) {
      if (chainAddresses.poolFactory) {
        await pool.query(
          `UPDATE protocol_contracts
              SET is_current = false, superseded_by_address = $2
            WHERE chain_id = $1 AND kind = 'PoolFactory' AND address <> $2 AND is_current`,
          [chainId, chainAddresses.poolFactory],
        );
      }

      // Every non-pool contract @shiyld/shared currently tracks for this chain.
      // syd/staking/governor are commonly unset (empty string) today — skipped, not
      // seeded as an empty address.
      const candidates: Array<{ kind: string; address: string | undefined }> = [
        { kind: "PoolFactory", address: chainAddresses.poolFactory },
        { kind: "EpochManager", address: chainAddresses.epochManager },
        { kind: "ParameterRegistry", address: chainAddresses.parameterRegistry },
        { kind: "SYD", address: chainAddresses.syd },
        { kind: "Staking", address: chainAddresses.staking },
        { kind: "Governor", address: chainAddresses.governor },
      ];
      for (const { kind, address } of candidates) {
        if (!address) continue;
        await upsertProtocolContract(pool, chainId, address, kind, chainAddresses.deploymentBlock);
        contractsSeeded++;
      }
    }

    const testnetSyd = TESTNET_SYD[chainId];
    if (testnetSyd?.address) {
      // @shiyld/shared doesn't track a distinct deployment block for TESTNET_SYD —
      // the chain's own pool deploymentBlock is reused as a conservative (earlier
      // than the real one) anchor: safe direction for a listener's scan start (a
      // little harmless extra scanning, never a missed event), not a claim of exact
      // accuracy.
      await upsertProtocolContract(pool, chainId, testnetSyd.address, "TestSYD", chainAddresses?.deploymentBlock ?? 0);
      contractsSeeded++;
    }
  }

  return { poolsSeeded, contractsSeeded };
}

async function upsertProtocolContract(
  pool: PgPool,
  chainId: number,
  address: string,
  kind: string,
  deploymentBlock: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO protocol_contracts (chain_id, address, kind, deployment_block, is_current, superseded_by_address)
     VALUES ($1, $2, $3, $4, true, NULL)
     ON CONFLICT (chain_id, address) DO UPDATE SET
       kind = EXCLUDED.kind,
       deployment_block = EXCLUDED.deployment_block`,
    [chainId, address, kind, deploymentBlock],
  );
}

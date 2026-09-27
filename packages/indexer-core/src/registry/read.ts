import type { Pool as PgPool } from "pg";
import type { Pool as PoolRecord } from "../schema/pools";
import type { ProtocolContract } from "../schema/contracts";

interface PoolRow {
  chain_id: number;
  pool_address: string;
  asset: string;
  version: string;
  deployment_block: string; // BIGINT comes back as a string from node-postgres by default
  deposit_verifier: string;
  transfer_verifier: string;
  withdraw_verifier: string;
  transfer2_verifier: string | null;
  withdraw2_verifier: string | null;
  circuit_artifact_hash: string | null;
  is_current: boolean;
  superseded_by_pool_address: string | null;
  supports_two_input: boolean;
  supports_deposit_ciphertext: boolean;
  supports_fee_enforcement: boolean;
}

function rowToPool(row: PoolRow): PoolRecord {
  return {
    chainId: row.chain_id,
    asset: row.asset,
    poolAddress: row.pool_address,
    version: row.version,
    deploymentBlock: Number(row.deployment_block),
    verifiers: {
      deposit: row.deposit_verifier,
      transfer: row.transfer_verifier,
      withdraw: row.withdraw_verifier,
      transfer2: row.transfer2_verifier ?? undefined,
      withdraw2: row.withdraw2_verifier ?? undefined,
    },
    circuitArtifactHash: row.circuit_artifact_hash,
    isCurrent: row.is_current,
    supersededByPoolAddress: row.superseded_by_pool_address,
    supports2Input: row.supports_two_input,
    supportsDepositCiphertext: row.supports_deposit_ciphertext,
    supportsFeeEnforcement: row.supports_fee_enforcement,
  };
}

interface ProtocolContractRow {
  chain_id: number;
  address: string;
  kind: string;
  deployment_block: string;
  is_current: boolean;
  superseded_by_address: string | null;
}

function rowToProtocolContract(row: ProtocolContractRow): ProtocolContract {
  return {
    chainId: row.chain_id,
    kind: row.kind,
    address: row.address,
    deploymentBlock: Number(row.deployment_block),
    isCurrent: row.is_current,
    supersededByAddress: row.superseded_by_address,
  };
}

/** GET /<network>/pools?asset= — every pool version for a chain, current and
 * superseded alike, optionally filtered to one asset. */
export async function getPools(pool: PgPool, chainId: number, asset?: string): Promise<PoolRecord[]> {
  const { rows } = asset
    ? await pool.query<PoolRow>(`SELECT * FROM pools WHERE chain_id = $1 AND asset = $2 ORDER BY deployment_block`, [chainId, asset])
    : await pool.query<PoolRow>(`SELECT * FROM pools WHERE chain_id = $1 ORDER BY deployment_block`, [chainId]);
  return rows.map(rowToPool);
}

/** GET /<network>/contracts — every non-pool protocol contract for a chain. */
export async function getProtocolContracts(pool: PgPool, chainId: number): Promise<ProtocolContract[]> {
  const { rows } = await pool.query<ProtocolContractRow>(
    `SELECT * FROM protocol_contracts WHERE chain_id = $1 ORDER BY deployment_block`,
    [chainId],
  );
  return rows.map(rowToProtocolContract);
}

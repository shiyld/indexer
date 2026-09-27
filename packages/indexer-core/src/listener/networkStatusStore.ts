import type { Pool as PgPool } from "pg";
import type { NetworkListenerStatus } from "./networkListener";

/** Twice a typical 10s persistence interval — generous, but not indefinite. A
 * worker crash must show up as "down" in /health, not hide behind an old row
 * forever — same "never silently trust stale data" discipline as the root
 * sanity-check in poolIngestion.ts. */
const STALE_THRESHOLD_MS = 30_000;

export async function saveNetworkStatus(db: PgPool, status: NetworkListenerStatus): Promise<void> {
  await db.query(
    `INSERT INTO network_status (chain_id, state, last_processed_block, chain_head_block, blocks_behind, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (chain_id) DO UPDATE SET
       state = EXCLUDED.state,
       last_processed_block = EXCLUDED.last_processed_block,
       chain_head_block = EXCLUDED.chain_head_block,
       blocks_behind = EXCLUDED.blocks_behind,
       updated_at = now()`,
    [status.chainId, status.state, status.lastProcessedBlock, status.chainHeadBlock, status.blocksBehind],
  );
}

interface NetworkStatusRow {
  chain_id: number;
  state: string;
  last_processed_block: string;
  chain_head_block: string;
  blocks_behind: string;
  updated_at: Date;
}

export async function getPersistedNetworkStatuses(db: PgPool, chainIds: number[]): Promise<NetworkListenerStatus[]> {
  if (chainIds.length === 0) return [];
  const { rows } = await db.query<NetworkStatusRow>(`SELECT * FROM network_status WHERE chain_id = ANY($1)`, [chainIds]);

  return rows.map((row) => {
    const isStale = Date.now() - row.updated_at.getTime() > STALE_THRESHOLD_MS;
    return {
      chainId: row.chain_id,
      state: isStale ? "down" : (row.state as NetworkListenerStatus["state"]),
      lastProcessedBlock: Number(row.last_processed_block),
      chainHeadBlock: Number(row.chain_head_block),
      blocksBehind: Number(row.blocks_behind),
    };
  });
}

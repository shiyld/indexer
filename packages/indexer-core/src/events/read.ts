import type { Pool as PgPool } from "pg";
import type { PoolEvent } from "../schema/events";

interface EventRow {
  pool_address: string;
  event_type: string;
  block_number: string;
  transaction_hash: string;
  log_index: number;
  data: Record<string, unknown>;
}

function rowToEvent(row: EventRow): PoolEvent {
  return {
    poolAddress: row.pool_address,
    blockNumber: Number(row.block_number),
    transactionHash: row.transaction_hash,
    logIndex: row.log_index,
    type: row.event_type,
    ...row.data,
  } as PoolEvent;
}

/** GET /<network>/pools/:poolAddress/events?fromBlock=&toBlock= ("Quick Sync") —
 * reads exactly what listener/poolIngestion.ts persisted, reassembled into the
 * same typed PoolEvent shape it was parsed into originally. */
export async function getEvents(
  db: PgPool,
  chainId: number,
  poolAddress: string,
  fromBlock: number,
  toBlock: number,
): Promise<PoolEvent[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT pool_address, event_type, block_number, transaction_hash, log_index, data
     FROM events WHERE chain_id = $1 AND pool_address = $2 AND block_number BETWEEN $3 AND $4
     ORDER BY block_number, log_index`,
    [chainId, poolAddress, fromBlock, toBlock],
  );
  return rows.map(rowToEvent);
}

import type { Pool as PgPool } from "pg";
import { networkByChainId } from "@shiyld/shared";
import { parsePoolEvent } from "./eventParser";
import type { PoolChainClient } from "./chainClient";
import type { RealtimeEmitter } from "../realtime/emitter";
import type { Pool as PoolRecord } from "../schema/pools";
import type { PoolEvent } from "../schema/events";

/** Matches wallet-core's scanner.ts. The public Base Sepolia RPC rejects any eth_getLogs
 * spanning more than 1,000 blocks ("eth_getLogs is limited to a 1,000 range", -32614), so
 * chunks must stay at or under that — larger chunks make a fresh pool's backfill fail forever. */
const BLOCK_CHUNK_SIZE = 1_000;

const STAT_COLUMN_BY_EVENT_TYPE: Partial<Record<PoolEvent["type"], string>> = {
  Deposit: "deposit_count",
  Transfer: "transfer_count",
  Withdrawal: "withdraw_count",
  // Transfer2/Withdrawal2 are still transfers/withdrawals, just multi-input — same
  // stat bucket, not a separate one.
  Transfer2: "transfer_count",
  Withdrawal2: "withdraw_count",
  LeafInserted: "leaf_count",
};

export interface PoolIngestionResult {
  fromBlock: number;
  toBlock: number;
  eventsProcessed: number;
  /** "skipped" when there was nothing new to ingest and no LeafInserted event to
   * check against. "mismatch" is a real, alert-worthy finding — see the log line
   * where it's detected. */
  rootSanityCheck: "ok" | "mismatch" | "skipped";
}

/**
 * Backfills and ingests one pool from its stored cursor (or its registry
 * deploymentBlock, for a genuinely first-ever run) up to the current chain head —
 * persisting every event, every Merkle leaf, and refreshed aggregate stats, then
 * sanity-checking the last processed LeafInserted event's root against a real,
 * block-pinned on-chain read. See CLAUDE.md's "Indexer: Full Design & Public
 * Distribution Plan" (Self-sync & health) for why this check matters: it's what
 * catches a missed or misordered event before a wallet ever tries to prove against
 * a Merkle root this indexer got wrong.
 */
export async function ingestPool(
  db: PgPool,
  client: PoolChainClient,
  pool: PoolRecord,
  head: number,
  emitter?: RealtimeEmitter,
): Promise<PoolIngestionResult> {
  const cursor = await loadCursor(db, pool.chainId, pool.poolAddress);
  const fromBlock = cursor !== null ? cursor + 1 : pool.deploymentBlock;

  if (fromBlock > head) {
    return { fromBlock, toBlock: head, eventsProcessed: 0, rootSanityCheck: "skipped" };
  }

  // Never emit realtime pushes during a pool's genuinely first-ever backfill —
  // potentially thousands of historical events, and nothing subscribes to a pool
  // before its first sync anyway. Only ever push live once this pool is already
  // caught up and simply tailing new blocks.
  const shouldEmit = emitter && cursor !== null;
  const networkSlug = shouldEmit ? networkByChainId(pool.chainId)?.slug : undefined;

  let eventsProcessed = 0;
  let lastLeafRoot: string | null = null;

  for (let chunkStart = fromBlock; chunkStart <= head; chunkStart += BLOCK_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + BLOCK_CHUNK_SIZE - 1, head);
    const logs = await client.getEventsInRange(chunkStart, chunkEnd);

    for (const log of logs) {
      const event = parsePoolEvent(pool.poolAddress, log as never);
      await persistEvent(db, pool.chainId, event);
      eventsProcessed++;

      if (networkSlug) emitter!.emitPoolEvent(networkSlug, pool.poolAddress, event);

      const statColumn = STAT_COLUMN_BY_EVENT_TYPE[event.type];
      if (statColumn) await bumpStat(db, pool.chainId, pool.poolAddress, statColumn);

      if (event.type === "LeafInserted") {
        await persistLeaf(db, pool.chainId, pool.poolAddress, event.leafIndex, event.leaf, event.blockNumber);
        lastLeafRoot = event.root;
      }
    }

    await saveCursor(db, pool.chainId, pool.poolAddress, chunkEnd);
  }

  const balance = await client.getBalance(pool.asset, pool.poolAddress, head);
  await updateBalance(db, pool.chainId, pool.poolAddress, balance);

  let rootSanityCheck: PoolIngestionResult["rootSanityCheck"] = "skipped";
  if (lastLeafRoot) {
    // Read at `head`, not at the leaf's own block: every log up to `head` was just
    // processed, so the on-chain root at `head` must equal the last leaf's root.
    // A leaf's block can be days old on a first backfill, and non-archive RPCs
    // (e.g. Arbitrum Sepolia's public endpoint) no longer serve that state.
    const onChainRoot = await client.getRootAt(head);
    rootSanityCheck = onChainRoot.toLowerCase() === lastLeafRoot.toLowerCase() ? "ok" : "mismatch";
    if (rootSanityCheck === "mismatch") {
      // eslint-disable-next-line no-console
      console.error(
        `[poolIngestion] ROOT MISMATCH for pool ${pool.poolAddress} (chain ${pool.chainId}) at block ` +
          `${head}: last LeafInserted event said ${lastLeafRoot}, on-chain root() says ${onChainRoot}. ` +
          `This indicates a missed or misordered event — do not trust this pool's Merkle proofs until resolved.`,
      );
    }
  }

  return { fromBlock, toBlock: head, eventsProcessed, rootSanityCheck };
}

async function loadCursor(db: PgPool, chainId: number, address: string): Promise<number | null> {
  const { rows } = await db.query<{ last_processed_block: string }>(
    `SELECT last_processed_block FROM ingestion_cursor WHERE chain_id = $1 AND address = $2`,
    [chainId, address],
  );
  return rows[0] ? Number(rows[0].last_processed_block) : null;
}

async function saveCursor(db: PgPool, chainId: number, address: string, block: number): Promise<void> {
  await db.query(
    `INSERT INTO ingestion_cursor (chain_id, address, last_processed_block, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chain_id, address) DO UPDATE SET last_processed_block = $3, updated_at = now()`,
    [chainId, address, block],
  );
}

async function persistEvent(db: PgPool, chainId: number, event: PoolEvent): Promise<void> {
  const { poolAddress, blockNumber, transactionHash, logIndex, type, ...data } = event;
  await db.query(
    `INSERT INTO events (chain_id, pool_address, event_type, block_number, transaction_hash, log_index, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    [chainId, poolAddress, type, blockNumber, transactionHash, logIndex, JSON.stringify(data)],
  );
}

async function persistLeaf(
  db: PgPool,
  chainId: number,
  poolAddress: string,
  leafIndex: number,
  leaf: string,
  blockNumber: number,
): Promise<void> {
  await db.query(
    `INSERT INTO merkle_leaves (chain_id, pool_address, leaf_index, leaf, block_number)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chain_id, pool_address, leaf_index) DO NOTHING`,
    [chainId, poolAddress, leafIndex, leaf, blockNumber],
  );
}

async function bumpStat(db: PgPool, chainId: number, poolAddress: string, column: string): Promise<void> {
  // `column` is always one of the fixed literal values in STAT_COLUMN_BY_EVENT_TYPE
  // above, never event- or user-controlled input — safe to interpolate.
  await db.query(
    `INSERT INTO pool_stats (chain_id, pool_address, ${column}, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (chain_id, pool_address) DO UPDATE SET ${column} = pool_stats.${column} + 1, updated_at = now()`,
    [chainId, poolAddress],
  );
}

async function updateBalance(db: PgPool, chainId: number, poolAddress: string, balance: bigint): Promise<void> {
  await db.query(
    `INSERT INTO pool_stats (chain_id, pool_address, current_balance, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chain_id, pool_address) DO UPDATE SET current_balance = $3, updated_at = now()`,
    [chainId, poolAddress, balance.toString()],
  );
}

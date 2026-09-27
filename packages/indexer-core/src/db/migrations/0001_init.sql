-- Registry of every deployed ShieldedPool version, current and superseded — never
-- dropped, since a user may still hold a note in an old version (see CLAUDE.md's
-- "Note-to-Pool Scoping Fix" and "Indexer: Full Design & Public Distribution Plan").
-- Bootstrap-seeded from @shiyld/shared's static ASSETS/ADDRESSES, then kept current
-- by packages/contracts's deploy scripts registering new rows going forward.
-- IF NOT EXISTS on every CREATE below is a narrow, historically-justified exception
-- to migrate.ts's own documented "not idempotent, real forward migrations" design —
-- it exists only because this specific first migration can collide with a database
-- that already has ingestion_cursor/pool_stats/stats_history from apps/api's old
-- bespoke SCHEMA_SQL mechanism, predating this migration-tracking system entirely
-- (confirmed live on Base Sepolia staging 2026-09-21: schema_migrations was empty
-- while those three tables already existed, so this migration failed on its very
-- first CREATE TABLE every time api-worker started, in one all-or-nothing
-- transaction, forever). Every migration after this one stays non-idempotent as
-- originally designed — this exception does not generalize forward.
CREATE TABLE IF NOT EXISTS pools (
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  asset TEXT NOT NULL,
  version TEXT NOT NULL,
  deployment_block BIGINT NOT NULL,
  deposit_verifier TEXT NOT NULL,
  transfer_verifier TEXT NOT NULL,
  withdraw_verifier TEXT NOT NULL,
  transfer2_verifier TEXT,
  withdraw2_verifier TEXT,
  -- Nullable: no infrastructure computes this yet anywhere in the codebase (no build
  -- step hashes packages/circuits's artifacts today) — left unpopulated rather than
  -- seeded with a fabricated value, same "never guess a value that isn't real yet"
  -- discipline as e.g. CHAINLINK_FEED_* being left blank in .env.example. Intended to
  -- be filled in once deploy-script auto-registration exists (it has direct access to
  -- the artifact it just used).
  circuit_artifact_hash TEXT,
  is_current BOOLEAN NOT NULL DEFAULT true,
  superseded_by_pool_address TEXT,
  supports_two_input BOOLEAN NOT NULL DEFAULT false,
  supports_deposit_ciphertext BOOLEAN NOT NULL DEFAULT false,
  supports_fee_enforcement BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, pool_address)
);
CREATE INDEX IF NOT EXISTS pools_asset_idx ON pools (chain_id, asset);
CREATE INDEX IF NOT EXISTS pools_current_idx ON pools (chain_id, asset, is_current);

-- Registry of every non-pool protocol contract ($SYD, PoolFactory, Governor,
-- Timelock, Staking, Treasury, ParameterRegistry, EpochManager, ...). `kind` is
-- free-form on purpose (see the zod ProtocolContractSchema's own comment) — a new
-- contract kind will exist long before this table's callers get a version bump for
-- it, and an unrecognized kind should just be ignored, not break anything.
CREATE TABLE IF NOT EXISTS protocol_contracts (
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  kind TEXT NOT NULL,
  deployment_block BIGINT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  superseded_by_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS protocol_contracts_kind_idx ON protocol_contracts (chain_id, kind, is_current);

-- One row per (chain, watched address) — pool or protocol contract alike, so this
-- one table serves both registries. The listener's own resume point on restart;
-- also what self-sync compares against the real chain head on startup/reconnect
-- (see CLAUDE.md's "Self-sync & health").
CREATE TABLE IF NOT EXISTS ingestion_cursor (
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  last_processed_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address)
);

-- Raw event log — kept forever (a note might be spent years after being deposited,
-- so pruning this would silently break proof generation for whoever still holds
-- it — a correctness bug, not a cleanup). Event-specific fields live in `data`
-- (JSONB) rather than one sparse column per possible field across the six different
-- ShieldedPool event shapes — `data`'s exact contents are governed by the zod
-- PoolEventSchema discriminated union in this same package, keyed by `event_type`.
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  event_type TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS events_pool_block_idx ON events (chain_id, pool_address, block_number);

-- One row per inserted Merkle leaf — the authoritative source for recomputing a
-- proof on demand (GET /<network>/pools/:poolAddress/merkle-proof/:leafIndex).
-- Populated directly from LeafInserted events, in emission order — never pruned,
-- for the same reason `events` isn't.
CREATE TABLE IF NOT EXISTS merkle_leaves (
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  leaf_index INTEGER NOT NULL,
  leaf TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  PRIMARY KEY (chain_id, pool_address, leaf_index)
);

-- Live, continuously-updated aggregate per pool — same shape as apps/api's own
-- pre-existing pool_stats table, since this supersedes it once apps/api embeds
-- indexer-core (see Phase 3 item #12 in CLAUDE.md).
CREATE TABLE IF NOT EXISTS pool_stats (
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  deposit_count BIGINT NOT NULL DEFAULT 0,
  transfer_count BIGINT NOT NULL DEFAULT 0,
  withdraw_count BIGINT NOT NULL DEFAULT 0,
  leaf_count BIGINT NOT NULL DEFAULT 0,
  current_balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, pool_address)
);

-- Periodic snapshots of pool_stats — the one table with a real retention/rollup
-- policy (see CLAUDE.md's "Database" section), since it's pure display convenience,
-- always re-derivable from `events` if it were ever lost.
CREATE TABLE IF NOT EXISTS stats_history (
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
CREATE INDEX IF NOT EXISTS stats_history_pool_time_idx ON stats_history (chain_id, pool_address, snapshot_at);

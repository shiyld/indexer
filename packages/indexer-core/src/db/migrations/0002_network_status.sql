-- Cross-process network health, for the split server/worker deployment mode
-- (mirroring apps/api's own proven split): the singleton worker — the only
-- process holding real MultiNetworkListener instances — writes its status here
-- periodically; stateless server replicas, which run no listener of their own,
-- read it for GET /health. The combined single-process mode (apps/indexer's
-- default self-host entrypoint) never touches this table at all — it holds its
-- own listener in-process and reads status directly, with no DB round-trip or
-- staleness concern.
CREATE TABLE network_status (
  chain_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  last_processed_block BIGINT NOT NULL,
  chain_head_block BIGINT NOT NULL,
  blocks_behind BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

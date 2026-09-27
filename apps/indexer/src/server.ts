// Must be the first import — see env.ts's own comment on why.
import "./env";
import { createServer } from "node:http";
import { Pool } from "pg";
import { createIndexerApp, attachSocketServer, createCache, createAccessControlConfig, getPersistedNetworkStatuses } from "@shiyld/indexer-core";
import {
  DATABASE_URL,
  REDIS_URL,
  INDEXER_HTTP_PORT,
  INDEXER_ACCESS_MODE,
  INDEXER_API_KEYS,
  INDEXER_RATE_LIMIT_PER_MINUTE,
  resolveNetworks,
} from "./config";

/**
 * Stateless server entrypoint for the clustered deployment (N replicas) —
 * mirrors apps/api's own proven server/worker split exactly. Runs no listener
 * of its own; network health comes from the network_status table the singleton
 * worker (worker.ts) writes to, since there's no single in-process
 * MultiNetworkListener instance to ask when N replicas share one worker.
 * REDIS_URL is required here (not optional, unlike the combined index.ts mode)
 * — more than one server replica needs the Redis Socket.IO adapter for
 * cross-replica delivery, the same condition that already governs the cache
 * backend.
 */
async function main() {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is required for the clustered server entrypoint (server.ts) — a single instance should run index.ts instead.");
  }

  const db = new Pool({ connectionString: DATABASE_URL });
  const chainIds = resolveNetworks().map((n) => n.chainId);

  const accessControl = createAccessControlConfig(INDEXER_ACCESS_MODE, INDEXER_API_KEYS);
  const httpServer = createServer();
  await attachSocketServer(httpServer, { redisUrl: REDIS_URL, accessControl });
  const cache = await createCache(REDIS_URL);

  const app = createIndexerApp({
    db,
    getNetworkStatuses: () => getPersistedNetworkStatuses(db, chainIds),
    capabilities: { subscribe: true },
    cache,
    accessControl,
    rateLimitPerMinute: INDEXER_RATE_LIMIT_PER_MINUTE,
  });

  httpServer.on("request", app);
  httpServer.listen(INDEXER_HTTP_PORT, () => {
    console.log(`[indexer-server] listening on :${INDEXER_HTTP_PORT} — reading network status from Postgres (chains: ${chainIds.join(", ")})`);
  });
}

main().catch((err) => {
  console.error("[indexer-server] fatal startup error:", err);
  process.exit(1);
});

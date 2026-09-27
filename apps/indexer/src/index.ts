// Must be the first import — see env.ts's own comment on why (ES module import
// hoisting; config.ts reads process.env at module-load time).
import "./env";
import { createServer } from "node:http";
import { Pool } from "pg";
import {
  runMigrations,
  defaultMigrationsDir,
  seedRegistryFromSharedConstants,
  createIndexerApp,
  attachSocketServer,
  createCache,
  createAccessControlConfig,
  MultiNetworkListener,
} from "@shiyld/indexer-core";
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
 * Combined single-process mode — the default entrypoint (`npm start`, and the
 * Docker image's default CMD): one process runs the listener, the REST API, and
 * Socket.IO together, with no Redis required. This is what a self-hoster's
 * plain `docker compose up` actually runs. Shiyld's own clustered
 * indexer.shiyld.com instead runs server.ts/worker.ts as separate processes
 * (see those files) — same @shiyld/indexer-core building blocks, just split for
 * horizontal scaling. See CLAUDE.md's "Indexer: Full Design & Public
 * Distribution Plan."
 */
async function main() {
  const db = new Pool({ connectionString: DATABASE_URL });

  const applied = await runMigrations(db, defaultMigrationsDir());
  if (applied.length > 0) console.log(`[indexer] applied migration(s): ${applied.join(", ")}`);

  const seedResult = await seedRegistryFromSharedConstants(db);
  console.log(`[indexer] registry seeded: ${seedResult.poolsSeeded} pool(s), ${seedResult.contractsSeeded} protocol contract(s)`);

  const accessControl = createAccessControlConfig(INDEXER_ACCESS_MODE, INDEXER_API_KEYS);
  const httpServer = createServer();
  // The socket server doubles as the realtime emitter here — same process, no
  // Redis needed to get an event from "just ingested" to "delivered to a
  // connected client."
  const socketServer = await attachSocketServer(httpServer, { redisUrl: REDIS_URL, accessControl });
  const cache = await createCache(REDIS_URL);

  const networks = resolveNetworks();
  const listener = new MultiNetworkListener(db, networks, { emitter: socketServer });
  await listener.start();

  const app = createIndexerApp({
    db,
    getNetworkStatuses: () => listener.getStatuses(),
    capabilities: { subscribe: true },
    cache,
    accessControl,
    rateLimitPerMinute: INDEXER_RATE_LIMIT_PER_MINUTE,
  });
  httpServer.on("request", app);

  httpServer.listen(INDEXER_HTTP_PORT, () => {
    console.log(
      `[indexer] listening on :${INDEXER_HTTP_PORT} — networks: ${networks.map((n) => n.chainId).join(", ")}` +
        (REDIS_URL ? " (Redis-backed cache/socket adapter)" : " (single-instance, in-memory cache/socket adapter)"),
    );
  });
}

main().catch((err) => {
  console.error("[indexer] fatal startup error:", err);
  process.exit(1);
});

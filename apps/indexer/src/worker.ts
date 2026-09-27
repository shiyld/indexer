// Must be the first import — see env.ts's own comment on why.
import "./env";
import { Pool } from "pg";
import {
  runMigrations,
  defaultMigrationsDir,
  seedRegistryFromSharedConstants,
  createRedisRealtimeEmitter,
  MultiNetworkListener,
  startStatusPersistence,
} from "@shiyld/indexer-core";
import { DATABASE_URL, REDIS_URL, resolveNetworks } from "./config";

/**
 * The singleton worker for the clustered deployment (1 replica) — the only
 * process that talks to RPC, mirroring apps/api's own proven server/worker
 * split. Publishes realtime events purely via Redis (no live socket
 * connections of its own — any server.ts replica subscribed to the same Redis
 * instance delivers to whichever client actually holds the connection), and
 * periodically persists its listener statuses to network_status for server.ts
 * replicas to read.
 */
async function main() {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is required for the clustered worker entrypoint (worker.ts) — a single instance should run index.ts instead.");
  }

  const db = new Pool({ connectionString: DATABASE_URL });

  const applied = await runMigrations(db, defaultMigrationsDir());
  if (applied.length > 0) console.log(`[indexer-worker] applied migration(s): ${applied.join(", ")}`);

  const seedResult = await seedRegistryFromSharedConstants(db);
  console.log(`[indexer-worker] registry seeded: ${seedResult.poolsSeeded} pool(s), ${seedResult.contractsSeeded} protocol contract(s)`);

  const emitter = await createRedisRealtimeEmitter(REDIS_URL);
  const networks = resolveNetworks();
  const listener = new MultiNetworkListener(db, networks, { emitter });
  await listener.start();

  startStatusPersistence(db, listener);

  console.log(`[indexer-worker] started — networks: ${networks.map((n) => n.chainId).join(", ")}`);
}

main().catch((err) => {
  console.error("[indexer-worker] fatal startup error:", err);
  process.exit(1);
});

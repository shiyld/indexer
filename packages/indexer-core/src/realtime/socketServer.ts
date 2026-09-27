import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { RealtimeEmitter } from "./emitter";
import { poolRoom } from "./emitter";
import { createAccessControlConfig, type AccessControlConfig } from "../hardening/accessControl";
import { createSocketAuthMiddleware } from "../hardening/socketAuth";

export interface CreateSocketServerOptions {
  /** Same REDIS_URL that also switches the cache backend (item #8) — one shared
   * "am I clustered?" signal, not two independently-configured settings. Unset
   * means a single-instance in-memory Socket.IO adapter, which is all most
   * self-hosters ever need. */
  redisUrl?: string;
  /** Shared with createIndexerApp's own accessControl option — REST and the
   * socket layer can never drift into inconsistent lockdown states. */
  accessControl?: AccessControlConfig;
}

export interface IndexerSocketServer extends RealtimeEmitter {
  io: SocketIOServer;
  close(): Promise<void>;
}

/**
 * Attaches Socket.IO at /subscribe — per-network namespace (`/base-sepolia`,
 * `/base`, ...), per-pool room within each namespace, full event data (not a
 * ping) per CLAUDE.md's "Indexer: Full Design & Public Distribution Plan." CORS
 * is open by default here, same reasoning as the REST layer: no cookies/session
 * auth involved, and the whole point is any wallet/app should be able to
 * subscribe from any origin.
 */
export async function attachSocketServer(httpServer: HttpServer, options: CreateSocketServerOptions = {}): Promise<IndexerSocketServer> {
  const io = new SocketIOServer(httpServer, { path: "/subscribe", cors: { origin: "*" } });

  let redisClients: { pubClient: RedisClientType; subClient: RedisClientType } | null = null;
  if (options.redisUrl) {
    const pubClient = createClient({ url: options.redisUrl }) as RedisClientType;
    const subClient = pubClient.duplicate() as RedisClientType;
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    redisClients = { pubClient, subClient };
  }

  // Socket.IO v4 rejects a connection to any namespace that was never explicitly
  // registered (a deliberate DoS-prevention change from earlier versions, where
  // an arbitrary namespace string would auto-create one) — so network namespaces
  // can't be created lazily on first emit; something has to register the pattern
  // upfront. A dynamic namespace matcher is Socket.IO's own documented mechanism
  // for exactly this case (the set of valid network slugs is data-driven and can
  // grow via the registry's live-reload, so a fixed, enumerated list of
  // `io.of("/name")` calls would need re-registering every time a new network is
  // added). `io.of("/<exact-slug>")` used for emitting below correctly resolves
  // to the same namespace instance a real client's connection matched against
  // this pattern.
  const dynamicNamespace = io.of(/^\/[a-z0-9-]+$/);
  dynamicNamespace.use(createSocketAuthMiddleware(options.accessControl ?? createAccessControlConfig()));
  dynamicNamespace.on("connection", (socket) => {
    socket.on("subscribe", (poolAddress: string) => socket.join(poolRoom(poolAddress)));
    socket.on("unsubscribe", (poolAddress: string) => socket.leave(poolRoom(poolAddress)));
  });

  return {
    io,
    emitPoolEvent(networkSlug, poolAddress, event) {
      io.of(`/${networkSlug}`)
        .to(poolRoom(poolAddress))
        .emit("event", event);
    },
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (redisClients) {
        await redisClients.pubClient.quit();
        await redisClients.subClient.quit();
      }
    },
  };
}

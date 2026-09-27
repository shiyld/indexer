import { Emitter } from "@socket.io/redis-emitter";
import { createClient, type RedisClientType } from "redis";
import type { RealtimeEmitter } from "./emitter";
import { poolRoom } from "./emitter";

export interface RedisRealtimeEmitter extends RealtimeEmitter {
  disconnect(): Promise<void>;
}

/**
 * Publishes into Socket.IO rooms without ever holding a client connection itself
 * — for the split server/worker deployment shape (Shiyld's own clustered
 * instance, mirroring apps/api's proven pattern): the worker process runs the
 * listener and publishes here; any attachSocketServer replica subscribed via the
 * Redis adapter delivers to whichever client actually holds the connection.
 */
export async function createRedisRealtimeEmitter(redisUrl: string): Promise<RedisRealtimeEmitter> {
  const client: RedisClientType = createClient({ url: redisUrl }) as RedisClientType;
  await client.connect();
  const emitter = new Emitter(client);

  return {
    emitPoolEvent(networkSlug, poolAddress, event) {
      emitter
        .of(`/${networkSlug}`)
        .to(poolRoom(poolAddress))
        .emit("event", event);
    },
    async disconnect() {
      await client.quit();
    },
  };
}

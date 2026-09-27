import { createClient, type RedisClientType } from "redis";
import type { CacheAdapter } from "./adapter";

export interface RedisCacheAdapter extends CacheAdapter {
  disconnect(): Promise<void>;
}

/**
 * Redis-backed cache — used once REDIS_URL is set, the same condition that also
 * switches the Socket.IO adapter (item #9) to Redis, so one env var governs both
 * concerns together rather than two independently-configured settings a
 * self-hoster could misconfigure by setting one but not the other.
 */
export async function createRedisCache(redisUrl: string): Promise<RedisCacheAdapter> {
  const client: RedisClientType = createClient({ url: redisUrl }) as RedisClientType;
  await client.connect();

  return {
    async get(key) {
      const value = await client.get(key);
      return value ?? undefined;
    },
    async set(key, value, ttlSeconds) {
      await client.set(key, value, { EX: ttlSeconds });
    },
    async del(key) {
      await client.del(key);
    },
    async disconnect() {
      await client.quit();
    },
  };
}

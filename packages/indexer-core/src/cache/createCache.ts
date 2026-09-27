import { createMemoryCache } from "./memoryCache";
import { createRedisCache } from "./redisCache";
import type { CacheAdapter } from "./adapter";

/**
 * One REDIS_URL decides the backend for both this cache and the Socket.IO
 * cross-replica adapter (item #9) — a single shared "am I clustered?" signal, not
 * two independently-configured settings. See CLAUDE.md's "Indexer: Full Design &
 * Public Distribution Plan," Caching.
 */
export async function createCache(redisUrl?: string): Promise<CacheAdapter> {
  if (redisUrl) return createRedisCache(redisUrl);
  return createMemoryCache();
}

import { LRUCache } from "lru-cache";
import type { CacheAdapter } from "./adapter";

/**
 * In-memory cache — the default backend for a single-instance indexer, whether
 * run via `npm start` on bare metal or as one Docker container. `REDIS_URL`, not
 * deployment method, is what actually decides whether Redis is needed — a single
 * instance never needs it at all. See CLAUDE.md's "Indexer: Full Design & Public
 * Distribution Plan," Caching.
 */
export function createMemoryCache(maxEntries = 10_000): CacheAdapter {
  const cache = new LRUCache<string, string>({ max: maxEntries });

  return {
    async get(key) {
      return cache.get(key);
    },
    async set(key, value, ttlSeconds) {
      cache.set(key, value, { ttl: ttlSeconds * 1000 });
    },
    async del(key) {
      cache.delete(key);
    },
  };
}

/**
 * One small interface both cache backends implement — string in, string out, so
 * memory and Redis behave identically from a caller's perspective. Callers own
 * their own JSON serialization (see cachedReads.ts) rather than this interface
 * carrying generics, keeping both backend implementations trivial.
 */
export interface CacheAdapter {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

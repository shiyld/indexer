import { createRedisCache, type RedisCacheAdapter } from "./redisCache";

/** Real integration test against the shared dev Redis container — uses logical DB
 * 15 (Redis's conventional test-isolation database) so this never touches DB 0,
 * which the real running apps/api/api-worker use for the Socket.IO adapter and
 * price cache. Requires TEST_REDIS_URL; skips (not fails) otherwise. */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const describeIfRedis = TEST_REDIS_URL ? describe : describe.skip;

describeIfRedis("createRedisCache (real Redis)", () => {
  let cache: RedisCacheAdapter;

  beforeEach(async () => {
    cache = await createRedisCache(TEST_REDIS_URL!);
  });

  afterEach(async () => {
    await cache.del("k"); // leave the shared test DB clean
    await cache.disconnect();
  });

  it("returns undefined for a key that was never set", async () => {
    expect(await cache.get("definitely-never-set-key")).toBeUndefined();
  });

  it("round-trips a value through the real Redis server", async () => {
    await cache.set("k", "v", 60);
    expect(await cache.get("k")).toBe("v");
  });

  it("del removes a value immediately", async () => {
    await cache.set("k", "v", 60);
    await cache.del("k");
    expect(await cache.get("k")).toBeUndefined();
  });

  it("expires a value after its TTL elapses (real server-side EX, not client-side)", async () => {
    await cache.set("k", "v", 1);
    expect(await cache.get("k")).toBe("v");
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(await cache.get("k")).toBeUndefined();
  }, 5000);
});

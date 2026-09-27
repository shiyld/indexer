import { createMemoryCache } from "./memoryCache";

describe("createMemoryCache", () => {
  it("returns undefined for a key that was never set", async () => {
    const cache = createMemoryCache();
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("round-trips a value", async () => {
    const cache = createMemoryCache();
    await cache.set("k", "v", 60);
    expect(await cache.get("k")).toBe("v");
  });

  it("del removes a value immediately", async () => {
    const cache = createMemoryCache();
    await cache.set("k", "v", 60);
    await cache.del("k");
    expect(await cache.get("k")).toBeUndefined();
  });

  it("expires a value after its TTL elapses", async () => {
    const cache = createMemoryCache();
    await cache.set("k", "v", 0.05); // 50ms
    expect(await cache.get("k")).toBe("v");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await cache.get("k")).toBeUndefined();
  });

  it("evicts the least-recently-used entry once maxEntries is exceeded", async () => {
    const cache = createMemoryCache(2);
    await cache.set("a", "1", 60);
    await cache.set("b", "2", 60);
    await cache.set("c", "3", 60); // evicts "a", the least recently used
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe("2");
    expect(await cache.get("c")).toBe("3");
  });
});

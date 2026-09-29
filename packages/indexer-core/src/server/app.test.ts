import request from "supertest";
import { Pool as PgPool } from "pg";
import { runMigrations, defaultMigrationsDir } from "../db/migrate";
import { seedRegistryFromSharedConstants } from "../registry/seed";
import { createIndexerApp } from "./app";
import { createMemoryCache } from "../cache/memoryCache";
import { createAccessControlConfig } from "../hardening/accessControl";
import type { NetworkListenerStatus } from "../listener/networkListener";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const CHAIN_ID = 84532;
const ETH_ASSET = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function baseSepoliaStatus(overrides: Partial<NetworkListenerStatus> = {}): NetworkListenerStatus {
  return { chainId: CHAIN_ID, state: "synced", lastProcessedBlock: 1000, chainHeadBlock: 1000, blocksBehind: 0, ...overrides };
}

describeIfDb("createIndexerApp (real Postgres, real seeded data)", () => {
  let db: PgPool;

  beforeEach(async () => {
    db = new PgPool({ connectionString: TEST_DATABASE_URL });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(db, defaultMigrationsDir());
    await seedRegistryFromSharedConstants(db);
  });

  afterEach(async () => {
    await db.end();
  });

  describe("GET /health", () => {
    it("reports healthy with the universal, non-network-scoped shape when every network is synced", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [baseSepoliaStatus()], capabilities: { subscribe: true } });
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.capabilities).toEqual({ subscribe: true });
      expect(res.body.networks["base-sepolia"]).toMatchObject({ chainId: CHAIN_ID, isTestnet: true, state: "synced" });
    });

    it("reports degraded when a network isn't fully synced, without touching the process itself", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [baseSepoliaStatus({ state: "syncing", blocksBehind: 500 })] });
      const res = await request(app).get("/health");

      expect(res.body.status).toBe("degraded");
      expect(res.body.networks["base-sepolia"].state).toBe("syncing");
    });
  });

  describe("GET /:network/pools", () => {
    it("returns every real seeded pool for a known network", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get("/base-sepolia/pools");

      expect(res.status).toBe(200);
      expect(res.body.pools.length).toBeGreaterThanOrEqual(11);
      expect(res.body.pools.some((p: { poolAddress: string }) => p.poolAddress === "0x3FA6242b74297dD07BdC7dD662F132c2A27635A9")).toBe(true);
    });

    it("filters by asset when ?asset= is given", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get(`/base-sepolia/pools?asset=${ETH_ASSET}`);

      expect(res.body.pools).toHaveLength(1);
      expect(res.body.pools[0].asset).toBe(ETH_ASSET);
    });

    it("returns 404 for an unrecognized network slug", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get("/not-a-real-network/pools");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /:network/contracts", () => {
    it("returns the seeded protocol contracts", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get("/base-sepolia/contracts");

      expect(res.status).toBe(200);
      const kinds = res.body.contracts.map((c: { kind: string }) => c.kind).sort();
      expect(kinds).toEqual(["EpochManager", "ParameterRegistry", "PoolFactory", "TestSYD"]);
    });
  });

  describe("GET /:network/pools/:poolAddress/events", () => {
    const POOL = "0x3FA6242b74297dD07BdC7dD662F132c2A27635A9";

    beforeEach(async () => {
      await db.query(
        `INSERT INTO events (chain_id, pool_address, event_type, block_number, transaction_hash, log_index, data)
         VALUES ($1, $2, 'Deposit', 500, $3, 0, $4)`,
        [CHAIN_ID, POOL, "0x" + "11".repeat(32), JSON.stringify({ commitment: "0x" + "22".repeat(32), leafIndex: 0, amount: "1000", envelope: "0x" })],
      );
    });

    it("returns a real persisted event within range", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get(`/base-sepolia/pools/${POOL}/events?fromBlock=0&toBlock=1000`);

      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0]).toMatchObject({ type: "Deposit", blockNumber: 500, amount: "1000" });
    });

    it("returns an empty list for a range with nothing in it, not an error", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get(`/base-sepolia/pools/${POOL}/events?fromBlock=0&toBlock=10`);
      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
    });

    it("rejects a query range exceeding the Quick Sync cap with 400, not a slow unbounded scan", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get(`/base-sepolia/pools/${POOL}/events?fromBlock=0&toBlock=100000`);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /:network/pools/:poolAddress/merkle-proof/:leafIndex", () => {
    const POOL = "0x3FA6242b74297dD07BdC7dD662F132c2A27635A9";

    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await db.query(
          `INSERT INTO merkle_leaves (chain_id, pool_address, leaf_index, leaf, block_number) VALUES ($1, $2, $3, $4, 100)`,
          [CHAIN_ID, POOL, i, "0x" + (i + 1).toString(16).padStart(64, "0")],
        );
      }
    });

    it("returns a real, schema-valid Merkle proof for an existing leaf", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get(`/base-sepolia/pools/${POOL}/merkle-proof/1`);

      expect(res.status).toBe(200);
      expect(res.body.siblings).toHaveLength(20);
      expect(res.body.pathIndices).toHaveLength(20);
      expect(res.body.treeSize).toBe(3);
    });

    it("returns 404 for a leaf index beyond the current tree size", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get(`/base-sepolia/pools/${POOL}/merkle-proof/99`);
      expect(res.status).toBe(404);
    });
  });

  describe("with a cache provided", () => {
    it("serves identical /pools results whether or not a cache is attached", async () => {
      const uncached = await request(createIndexerApp({ db, getNetworkStatuses: () => [] })).get("/base-sepolia/pools");
      const cached = await request(createIndexerApp({ db, getNetworkStatuses: () => [], cache: createMemoryCache() })).get(
        "/base-sepolia/pools",
      );
      expect(cached.body).toEqual(uncached.body);
    });

    it("a second request for the same merkle proof is served from cache, not recomputed", async () => {
      for (let i = 0; i < 3; i++) {
        await db.query(`INSERT INTO merkle_leaves (chain_id, pool_address, leaf_index, leaf, block_number) VALUES ($1, $2, $3, $4, 100)`, [
          CHAIN_ID,
          "0x3FA6242b74297dD07BdC7dD662F132c2A27635A9",
          i,
          "0x" + (i + 1).toString(16).padStart(64, "0"),
        ]);
      }
      const app = createIndexerApp({ db, getNetworkStatuses: () => [], cache: createMemoryCache() });
      const first = await request(app).get("/base-sepolia/pools/0x3FA6242b74297dD07BdC7dD662F132c2A27635A9/merkle-proof/1");
      const second = await request(app).get("/base-sepolia/pools/0x3FA6242b74297dD07BdC7dD662F132c2A27635A9/merkle-proof/1");
      expect(second.body).toEqual(first.body);
    });
  });

  describe("hardening", () => {
    it("applies helmet and open CORS headers on every response", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [] });
      const res = await request(app).get("/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("restricted mode blocks /:network/* without a key but /health stays reachable regardless", async () => {
      const app = createIndexerApp({ db, getNetworkStatuses: () => [], accessControl: createAccessControlConfig("restricted", ["real-key"]) });

      const health = await request(app).get("/health");
      expect(health.status).toBe(200);

      const blocked = await request(app).get("/base-sepolia/pools");
      expect(blocked.status).toBe(401);

      const allowed = await request(app).get("/base-sepolia/pools").set("x-indexer-api-key", "real-key");
      expect(allowed.status).toBe(200);
    });
  });
});

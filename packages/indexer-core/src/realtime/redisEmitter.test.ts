import { createServer, type Server as HttpServer } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { attachSocketServer, type IndexerSocketServer } from "./socketServer";
import { createRedisRealtimeEmitter, type RedisRealtimeEmitter } from "./redisEmitter";

/** Real integration test against the shared dev Redis container (logical DB 15).
 * Requires TEST_REDIS_URL; skips otherwise. */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const describeIfRedis = TEST_REDIS_URL ? describe : describe.skip;

const POOL = "0xdddddddddddddddddddddddddddddddddddddddd".slice(0, 42);

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function connectClient(port: number): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}/base-sepolia`, { path: "/subscribe", forceNew: true, transports: ["websocket"] });
    socket.on("connect", () => {
      socket.emit("subscribe", POOL);
      resolve(socket);
    });
    socket.on("connect_error", reject);
  });
}

describeIfRedis("createRedisRealtimeEmitter — the split worker→server publish path", () => {
  let httpServer: HttpServer;
  let socketServer: IndexerSocketServer;
  let emitter: RedisRealtimeEmitter;

  beforeEach(async () => {
    httpServer = createServer();
    socketServer = await attachSocketServer(httpServer, { redisUrl: TEST_REDIS_URL });
    // The "worker" here holds no live socket connections at all — it only ever
    // publishes into Redis, mirroring apps/api's own proven server/worker split.
    emitter = await createRedisRealtimeEmitter(TEST_REDIS_URL!);
  });

  afterEach(async () => {
    await emitter.disconnect();
    await socketServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("a client connected only to the REST/socket server receives an event published purely via Redis, with no direct connection to the publisher", async () => {
    const port = await listen(httpServer);
    const client = await connectClient(port);
    const received = new Promise((resolve) => client.on("event", resolve));

    await new Promise((resolve) => setTimeout(resolve, 200));
    emitter.emitPoolEvent("base-sepolia", POOL, {
      type: "LeafInserted",
      poolAddress: POOL,
      blockNumber: 7,
      transactionHash: "0x" + "99".repeat(32),
      logIndex: 0,
      leafIndex: 3,
      leaf: "0x" + "aa".repeat(32),
      root: "0x" + "bb".repeat(32),
    });

    const event = await received;
    expect(event).toMatchObject({ type: "LeafInserted", poolAddress: POOL, leafIndex: 3 });
    client.close();
  }, 10000);
});

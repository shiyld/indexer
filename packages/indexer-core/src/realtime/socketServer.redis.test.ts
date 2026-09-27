import { createServer, type Server as HttpServer } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { attachSocketServer, type IndexerSocketServer } from "./socketServer";

/** Real integration test against the shared dev Redis container (logical DB 15,
 * same test-isolation convention as the other Redis tests in this package —
 * never DB 0, which the real running apps/api/api-worker use). Requires
 * TEST_REDIS_URL; skips otherwise. */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const describeIfRedis = TEST_REDIS_URL ? describe : describe.skip;

const POOL = "0xcccccccccccccccccccccccccccccccccccccc";

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

describeIfRedis("attachSocketServer — cross-replica broadcast via the real Redis adapter", () => {
  let serverA: HttpServer;
  let serverB: HttpServer;
  let replicaA: IndexerSocketServer;
  let replicaB: IndexerSocketServer;

  beforeEach(async () => {
    serverA = createServer();
    serverB = createServer();
    replicaA = await attachSocketServer(serverA, { redisUrl: TEST_REDIS_URL });
    replicaB = await attachSocketServer(serverB, { redisUrl: TEST_REDIS_URL });
  });

  afterEach(async () => {
    await replicaA.close();
    await replicaB.close();
    await Promise.all([
      new Promise<void>((resolve) => serverA.close(() => resolve())),
      new Promise<void>((resolve) => serverB.close(() => resolve())),
    ]);
  });

  it("delivers an event emitted on replica B to a client connected to replica A — the whole point of the Redis adapter", async () => {
    const portA = await listen(serverA);
    await listen(serverB);
    const client = await connectClient(portA);
    const received = new Promise((resolve) => client.on("event", resolve));

    await new Promise((resolve) => setTimeout(resolve, 200)); // let the subscribe + Redis adapter propagate
    replicaB.emitPoolEvent("base-sepolia", POOL, {
      type: "Withdrawal",
      poolAddress: POOL,
      blockNumber: 42,
      transactionHash: "0x" + "55".repeat(32),
      logIndex: 0,
      nullifier: "0x" + "66".repeat(32),
      recipient: "0x" + "77".repeat(20),
      amount: "999",
      changeCommitment: "0x" + "88".repeat(32),
      changeEnvelope: "0x",
    });

    const event = await received;
    expect(event).toMatchObject({ type: "Withdrawal", poolAddress: POOL, amount: "999" });
    client.close();
  }, 10000);
});

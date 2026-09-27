import { createServer, type Server as HttpServer } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { attachSocketServer, type IndexerSocketServer } from "./socketServer";

const POOL_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POOL_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function connectClient(port: number, namespace: string, poolAddress: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}/${namespace}`, { path: "/subscribe", forceNew: true, transports: ["websocket"] });
    socket.on("connect", () => {
      // The real subscribe mechanism attachSocketServer implements — not a
      // test-only convention.
      socket.emit("subscribe", poolAddress);
      resolve(socket);
    });
    socket.on("connect_error", reject);
  });
}

describe("attachSocketServer (real HTTP server, real socket.io-client, no Redis)", () => {
  let httpServer: HttpServer;
  let indexerSocket: IndexerSocketServer;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    port = await listen(httpServer);
    indexerSocket = await attachSocketServer(httpServer);
  });

  afterEach(async () => {
    await indexerSocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("delivers a real event to a client subscribed to the right network namespace and pool room", async () => {
    const client = await connectClient(port, "base-sepolia", POOL_A);
    const received = new Promise((resolve) => client.on("event", resolve));

    // Give the join a tick to land before emitting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    indexerSocket.emitPoolEvent("base-sepolia", POOL_A, {
      type: "Deposit",
      poolAddress: POOL_A,
      blockNumber: 1,
      transactionHash: "0x" + "11".repeat(32),
      logIndex: 0,
      commitment: "0x" + "22".repeat(32),
      leafIndex: 0,
      amount: "1000",
      envelope: "0x",
    });

    const event = await received;
    expect(event).toMatchObject({ type: "Deposit", poolAddress: POOL_A });
    client.close();
  });

  it("never delivers an event to a client subscribed to a different pool room", async () => {
    const client = await connectClient(port, "base-sepolia", POOL_B);
    const handler = jest.fn();
    client.on("event", handler);

    await new Promise((resolve) => setTimeout(resolve, 50));
    indexerSocket.emitPoolEvent("base-sepolia", POOL_A, {
      type: "Deposit",
      poolAddress: POOL_A,
      blockNumber: 1,
      transactionHash: "0x" + "11".repeat(32),
      logIndex: 0,
      commitment: "0x" + "22".repeat(32),
      leafIndex: 0,
      amount: "1000",
      envelope: "0x",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(handler).not.toHaveBeenCalled();
    client.close();
  });

  it("never delivers an event across different network namespaces", async () => {
    const client = await connectClient(port, "base", POOL_A); // different namespace, same pool address
    const handler = jest.fn();
    client.on("event", handler);

    await new Promise((resolve) => setTimeout(resolve, 50));
    indexerSocket.emitPoolEvent("base-sepolia", POOL_A, {
      type: "LeafInserted",
      poolAddress: POOL_A,
      blockNumber: 1,
      transactionHash: "0x" + "11".repeat(32),
      logIndex: 0,
      leafIndex: 0,
      leaf: "0x" + "33".repeat(32),
      root: "0x" + "44".repeat(32),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(handler).not.toHaveBeenCalled();
    client.close();
  });
});

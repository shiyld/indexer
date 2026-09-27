import { createServer, type Server as HttpServer } from "node:http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { attachSocketServer, type IndexerSocketServer } from "./socketServer";
import { createAccessControlConfig } from "../hardening/accessControl";

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("Socket.IO restricted-mode auth (real server, real client)", () => {
  let httpServer: HttpServer;
  let indexerSocket: IndexerSocketServer;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    port = await listen(httpServer);
    indexerSocket = await attachSocketServer(httpServer, { accessControl: createAccessControlConfig("restricted", ["real-key"]) });
  });

  afterEach(async () => {
    await indexerSocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(auth?: Record<string, string>): Promise<{ socket: ClientSocket; error?: Error }> {
    return new Promise((resolve) => {
      const socket: ClientSocket = ioClient(`http://localhost:${port}/base-sepolia`, {
        path: "/subscribe",
        forceNew: true,
        transports: ["websocket"],
        auth,
      });
      socket.on("connect", () => resolve({ socket }));
      socket.on("connect_error", (error: Error) => resolve({ socket, error }));
    });
  }

  it("rejects a connection with no apiKey", async () => {
    const { socket, error } = await connect();
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/restricted mode/);
    socket.close();
  });

  it("rejects a connection with the wrong apiKey", async () => {
    const { socket, error } = await connect({ apiKey: "wrong-key" });
    expect(error).toBeDefined();
    socket.close();
  });

  it("accepts a connection with the correct apiKey", async () => {
    const { socket, error } = await connect({ apiKey: "real-key" });
    expect(error).toBeUndefined();
    expect(socket.connected).toBe(true);
    socket.close();
  });
});

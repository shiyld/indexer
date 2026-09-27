import type { Socket } from "socket.io";
import type { AccessControlConfig } from "./accessControl";

/**
 * Socket.IO-layer enforcement of the same AccessControlConfig the REST layer
 * uses (accessMode.ts) — one shared config, so a self-hoster can't accidentally
 * lock down REST while leaving the socket layer wide open, or vice versa. In
 * "restricted" mode, the client must supply `auth.apiKey` in the handshake;
 * missing/wrong key rejects the connection outright rather than accepting it and
 * silently withholding data.
 */
export function createSocketAuthMiddleware(config: AccessControlConfig) {
  return function socketAuth(socket: Socket, next: (err?: Error) => void): void {
    if (config.mode === "public") return next();

    const apiKey = socket.handshake.auth?.apiKey as string | undefined;
    if (!apiKey || !config.apiKeys.has(apiKey)) {
      next(new Error("This indexer instance is in restricted mode — a valid apiKey is required in the connection handshake"));
      return;
    }
    next();
  };
}

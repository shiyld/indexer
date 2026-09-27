/**
 * Shared access-control config, used identically by the REST layer (accessMode.ts)
 * and the Socket.IO handshake (socketAuth.ts) — one config object, not two
 * independently-configured settings that could drift apart. Default mode is
 * "public": most self-hosters run a fully open, unauthenticated instance, matching
 * the whole point of a public indexer. "restricted" requires a real API key on
 * both channels.
 */
export interface AccessControlConfig {
  mode: "public" | "restricted";
  apiKeys: Set<string>;
}

export function createAccessControlConfig(mode: "public" | "restricted" = "public", apiKeys: Iterable<string> = []): AccessControlConfig {
  return { mode, apiKeys: new Set(apiKeys) };
}

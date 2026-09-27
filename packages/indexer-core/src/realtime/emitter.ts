import type { PoolEvent } from "../schema/events";

/** One small interface both realtime publishing shapes implement — a direct
 * Socket.IO server (single-process) or a Redis-backed emitter with no live
 * connections of its own (the split worker→server deployment shape). See
 * socketServer.ts / redisEmitter.ts. */
export interface RealtimeEmitter {
  emitPoolEvent(networkSlug: string, poolAddress: string, event: PoolEvent): void;
}

export function poolRoom(poolAddress: string): string {
  return `pool:${poolAddress.toLowerCase()}`;
}

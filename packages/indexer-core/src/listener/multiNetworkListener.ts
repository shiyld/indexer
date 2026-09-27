import type { Pool as PgPool } from "pg";
import { createNetworkListener, type NetworkListenerStatus } from "./networkListener";
import type { RealtimeEmitter } from "../realtime/emitter";

export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
}

export interface MultiNetworkListenerOptions {
  emitter?: RealtimeEmitter;
}

/**
 * The top-level multi-network orchestrator — one independent NetworkListener per
 * configured chain. Each is started without waiting on the others (one network's
 * slow initial backfill must never delay another network from starting), and each
 * runs its own isolated loop thereafter — a crash or persistent RPC failure on one
 * network never touches another sharing this process. See CLAUDE.md's "Multi-
 * network, single instance" design.
 */
export class MultiNetworkListener {
  private readonly listeners = new Map<number, ReturnType<typeof createNetworkListener>>();

  constructor(
    private readonly db: PgPool,
    private readonly networks: NetworkConfig[],
    private readonly options: MultiNetworkListenerOptions = {},
  ) {}

  async start(): Promise<void> {
    for (const { chainId, rpcUrl } of this.networks) {
      const listener = createNetworkListener(chainId, rpcUrl, this.db, { emitter: this.options.emitter });
      this.listeners.set(chainId, listener);
      listener.start().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[MultiNetworkListener] network ${chainId} failed to start:`, err);
      });
    }
  }

  stop(): void {
    for (const listener of this.listeners.values()) listener.stop();
  }

  getStatuses(): NetworkListenerStatus[] {
    return [...this.listeners.values()].map((l) => l.getStatus());
  }
}

import { JsonRpcProvider } from "ethers";
import type { Pool as PgPool } from "pg";
import { RegistryWatcher } from "../registry/watcher";
import { createEthersPoolChainClient, type PoolChainClient } from "./chainClient";
import { ingestPool } from "./poolIngestion";
import { withRetry } from "./retry";
import type { RealtimeEmitter } from "../realtime/emitter";
import type { Pool as PoolRecord } from "../schema/pools";
import type { NetworkState } from "../schema/health";

export interface NetworkListenerStatus {
  chainId: number;
  state: NetworkState;
  lastProcessedBlock: number;
  chainHeadBlock: number;
  blocksBehind: number;
}

export interface NetworkListenerDeps {
  chainId: number;
  db: PgPool;
  getBlockNumber: () => Promise<number>;
  createChainClient: (poolAddress: string) => PoolChainClient;
  pollIntervalMs?: number;
  registryPollIntervalMs?: number;
  /** Optional — omitting it just means no realtime push happens, the same "cache
   * is a pure optimization, never a hard dependency" property this package holds
   * throughout. */
  emitter?: RealtimeEmitter;
}

/**
 * Runs one independent polling loop per network, watching every currently-
 * registered pool for that chain (kept live-updated via RegistryWatcher — a
 * newly-deployed pool version starts being indexed with no restart required). A
 * crash on one pool's ingestion, or a total RPC outage for this network, must
 * never affect any other network sharing the same process — see CLAUDE.md's
 * "Indexer: Full Design & Public Distribution Plan."
 *
 * Chain access is fully injected (getBlockNumber/createChainClient), not
 * constructed internally, so this class is unit-testable against fakes with no
 * real network involved — see createNetworkListener below for the real,
 * ethers-backed production wiring.
 */
export class NetworkListener {
  private readonly chainId: number;
  private readonly db: PgPool;
  private readonly getBlockNumber: () => Promise<number>;
  private readonly createChainClient: (poolAddress: string) => PoolChainClient;
  private readonly registryWatcher: RegistryWatcher;
  private readonly pollIntervalMs: number;
  private readonly emitter?: RealtimeEmitter;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pools: PoolRecord[] = [];
  private status: NetworkListenerStatus;

  constructor(deps: NetworkListenerDeps) {
    this.chainId = deps.chainId;
    this.db = deps.db;
    this.getBlockNumber = deps.getBlockNumber;
    this.createChainClient = deps.createChainClient;
    this.pollIntervalMs = deps.pollIntervalMs ?? 15_000;
    this.emitter = deps.emitter;
    this.registryWatcher = new RegistryWatcher(deps.db, [deps.chainId], {
      pollIntervalMs: deps.registryPollIntervalMs ?? 30_000,
      onChange: (snapshot) => {
        this.pools = snapshot.pools;
      },
    });
    this.status = { chainId: this.chainId, state: "syncing", lastProcessedBlock: 0, chainHeadBlock: 0, blocksBehind: 0 };
  }

  /**
   * Loads the registry, runs one ingestion pass immediately, then starts polling.
   *
   * The initial registry load and the initial poll are both allowed to fail here
   * without this method rejecting — a transient RPC/DB hiccup at the exact moment
   * the process starts up must never prevent the interval below from ever being
   * scheduled. Without this, a single failed first attempt (e.g. a momentary
   * network blip) permanently wedges this network's listener in "down" for the
   * life of the process, since MultiNetworkListener only logs a start() rejection
   * and never retries it — confirmed live (2026-09-14): the standalone indexer's
   * base-sepolia listener hit exactly this after a transient RPC timeout during
   * container startup and stayed "down" for 43+ hours afterward with zero further
   * log output, even once the RPC endpoint was reachable again seconds later.
   * Resilience comes from the loop never stopping, matching retry.ts's own stated
   * design principle — it must apply to the first tick too, not just later ones.
   */
  async start(): Promise<void> {
    try {
      const snapshot = await this.registryWatcher.start();
      this.pools = snapshot.pools;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[NetworkListener:${this.chainId}] initial registry load failed:`, err);
      this.status = { ...this.status, state: "down" };
    }
    await this.poll().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[NetworkListener:${this.chainId}] initial poll failed:`, err);
      // status is already set to "down" inside poll() itself on this path
    });
    this.timer = setInterval(() => {
      this.poll().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[NetworkListener:${this.chainId}] poll cycle failed:`, err);
        this.status = { ...this.status, state: "down" };
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.registryWatcher.stop();
  }

  getStatus(): NetworkListenerStatus {
    return this.status;
  }

  private async poll(): Promise<void> {
    let head: number;
    try {
      head = await this.getBlockNumber();
    } catch (err) {
      this.status = { ...this.status, state: "down" };
      throw err;
    }

    if (this.pools.length === 0) {
      this.status = { chainId: this.chainId, state: "synced", lastProcessedBlock: head, chainHeadBlock: head, blocksBehind: 0 };
      return;
    }

    let minProcessed = head;
    let anyFailed = false;

    for (const pool of this.pools) {
      try {
        const client = this.createChainClient(pool.poolAddress);
        const result = await ingestPool(this.db, client, pool, head, this.emitter);
        minProcessed = Math.min(minProcessed, result.toBlock);
        if (result.rootSanityCheck === "mismatch") anyFailed = true;
      } catch (err) {
        // Fault isolation: one pool's failure must never stop the others in the
        // same network from being ingested this cycle.
        // eslint-disable-next-line no-console
        console.error(`[NetworkListener:${this.chainId}] pool ${pool.poolAddress} ingestion failed:`, err);
        anyFailed = true;
      }
    }

    const blocksBehind = head - minProcessed;
    this.status = {
      chainId: this.chainId,
      state: anyFailed ? "degraded" : blocksBehind <= 2 ? "synced" : "syncing",
      lastProcessedBlock: minProcessed,
      chainHeadBlock: head,
      blocksBehind,
    };
  }
}

/** Real, ethers-backed production wiring — the counterpart tests substitute fakes for. */
export function createNetworkListener(
  chainId: number,
  rpcUrl: string,
  db: PgPool,
  options: { pollIntervalMs?: number; registryPollIntervalMs?: number; emitter?: RealtimeEmitter } = {},
): NetworkListener {
  const provider = new JsonRpcProvider(rpcUrl, chainId);
  return new NetworkListener({
    chainId,
    db,
    getBlockNumber: () => withRetry(() => provider.getBlockNumber()),
    createChainClient: (poolAddress) => createEthersPoolChainClient(provider, poolAddress),
    ...options,
  });
}

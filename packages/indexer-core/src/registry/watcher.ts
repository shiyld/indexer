import type { Pool as PgPool } from "pg";
import { getPools, getProtocolContracts } from "./read";
import type { Pool as PoolRecord } from "../schema/pools";
import type { ProtocolContract } from "../schema/contracts";

export interface RegistrySnapshot {
  pools: PoolRecord[];
  contracts: ProtocolContract[];
}

export interface RegistryWatcherOptions {
  /** How often to re-poll the registry tables for changes. Default 30s — a
   * newly-registered pool needs "no restart required," never sub-second
   * reactivity (see CLAUDE.md's "Indexer: Full Design & Public Distribution
   * Plan"). */
  pollIntervalMs?: number;
  onChange?: (snapshot: RegistrySnapshot) => void;
}

/**
 * Watches the pools/protocol_contracts registries for changes and notifies a
 * callback — this is what lets a newly-deployed pool version start getting indexed
 * by every running instance, including third-party self-hosted ones, without a
 * restart. Polling-based, not LISTEN/NOTIFY-based: matches this project's
 * established preference for simple, reliable polling over persistent
 * subscriptions (wallet-core's scanner.ts and apps/api's poolListener.ts both made
 * the same call for the same reliability reasons), and this use case only ever
 * needs "eventually picked up," not low-latency push.
 */
export class RegistryWatcher {
  private readonly pool: PgPool;
  private readonly chainIds: number[];
  private readonly pollIntervalMs: number;
  private readonly onChange?: (snapshot: RegistrySnapshot) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotKey: string | null = null;
  private current: RegistrySnapshot = { pools: [], contracts: [] };

  constructor(pool: PgPool, chainIds: number[], options: RegistryWatcherOptions = {}) {
    this.pool = pool;
    this.chainIds = chainIds;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.onChange = options.onChange;
  }

  /**
   * Loads the current registry immediately and starts the polling loop.
   *
   * The initial load is allowed to fail without this method rejecting — a
   * transient DB hiccup at the exact moment the process starts up must never
   * prevent the interval below from ever being scheduled, or this watcher (and
   * whatever depends on its result, e.g. NetworkListener.start()) is permanently
   * stuck with zero pools/contracts and no retry for the life of the process. On
   * a failed initial load, `current` stays at its empty default and the interval
   * still starts, so the very next tick — and every one after — keeps trying.
   */
  async start(): Promise<RegistrySnapshot> {
    try {
      this.current = await this.loadAll();
      this.lastSnapshotKey = snapshotKey(this.current);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[RegistryWatcher] initial load failed:", err);
    }
    this.timer = setInterval(() => {
      this.poll().catch((err: unknown) => {
        // A failed poll must never crash the process — the next tick tries again,
        // matching this project's established per-loop fault-isolation discipline.
        // eslint-disable-next-line no-console
        console.error("[RegistryWatcher] poll failed:", err);
      });
    }, this.pollIntervalMs);
    return this.current;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(): RegistrySnapshot {
    return this.current;
  }

  private async poll(): Promise<void> {
    const next = await this.loadAll();
    const nextKey = snapshotKey(next);
    if (nextKey === this.lastSnapshotKey) return; // nothing changed, no callback fired

    this.current = next;
    this.lastSnapshotKey = nextKey;
    this.onChange?.(next);
  }

  private async loadAll(): Promise<RegistrySnapshot> {
    const pools: PoolRecord[] = [];
    const contracts: ProtocolContract[] = [];
    for (const chainId of this.chainIds) {
      pools.push(...(await getPools(this.pool, chainId)));
      contracts.push(...(await getProtocolContracts(this.pool, chainId)));
    }
    return { pools, contracts };
  }
}

/** A cheap, deterministic fingerprint of the registry's current shape — used to
 * detect "did anything actually change" without pulling in a deep-equality
 * dependency for one small comparison. */
function snapshotKey(snapshot: RegistrySnapshot): string {
  const poolKeys = snapshot.pools
    .map((p) => `${p.chainId}:${p.poolAddress}:${p.isCurrent}:${p.supersededByPoolAddress ?? ""}`)
    .sort();
  const contractKeys = snapshot.contracts.map((c) => `${c.chainId}:${c.address}:${c.isCurrent}`).sort();
  return JSON.stringify([poolKeys, contractKeys]);
}

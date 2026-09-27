import { networkByChainId } from "@shiyld/shared";
import type { NetworkListenerStatus } from "../listener/networkListener";
import type { HealthResponse, ServiceStatus } from "../schema/health";
import { API_CONTRACT_VERSION } from "../schema/version";

/**
 * Root `status` is a service-level rollup, deliberately a different vocabulary
 * from each network's own `state` — see CLAUDE.md's "Indexer: Full Design & Public
 * Distribution Plan." `failed` means the process itself is broken (DB
 * unreachable) — a real liveness failure, distinct from any individual network's
 * RPC trouble. `healthy` means every configured network is `synced`; anything
 * short of that (one or more `syncing`/`degraded`/`down`) is `degraded` — the
 * process is fine and still serving requests, a client just needs the per-network
 * detail before trusting that specific chain.
 */
export function computeServiceStatus(dbHealthy: boolean, networkStatuses: NetworkListenerStatus[]): ServiceStatus {
  if (!dbHealthy) return "failed";
  if (networkStatuses.every((s) => s.state === "synced")) return "healthy";
  return "degraded";
}

/** Builds the full /health response — networks keyed by their canonical slug
 * (falling back to the raw chainId if it isn't in @shiyld/shared's NETWORKS
 * registry yet, so an unrecognized-but-configured chain still reports rather
 * than being silently dropped). */
export function buildHealthResponse(
  dbHealthy: boolean,
  networkStatuses: NetworkListenerStatus[],
  capabilities: { subscribe: boolean },
): HealthResponse {
  const networks: HealthResponse["networks"] = {};
  for (const status of networkStatuses) {
    const network = networkByChainId(status.chainId);
    const key = network?.slug ?? String(status.chainId);
    networks[key] = {
      chainId: status.chainId,
      isTestnet: network?.isTestnet ?? false,
      state: status.state,
      lastProcessedBlock: status.lastProcessedBlock,
      chainHeadBlock: status.chainHeadBlock,
      blocksBehind: status.blocksBehind,
    };
  }

  return {
    status: computeServiceStatus(dbHealthy, networkStatuses),
    contractVersion: API_CONTRACT_VERSION,
    capabilities,
    networks,
  };
}

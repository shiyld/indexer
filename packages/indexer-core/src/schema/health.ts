import { z } from "zod";
import { BlockNumberSchema } from "./common";

/**
 * Per-network data freshness — answers "how fresh is THIS chain's data," the thing
 * RemoteSyncClient actually needs before trusting a Merkle proof from a given
 * network. Deliberately a different vocabulary from the root `status` below — see
 * CLAUDE.md's "Indexer: Full Design & Public Distribution Plan" for why the two are
 * kept separate rather than collapsed into one enum.
 */
export const NetworkStateSchema = z.enum(["synced", "syncing", "degraded", "down"]);
export type NetworkState = z.infer<typeof NetworkStateSchema>;

/**
 * Service-level rollup — answers "should this process keep receiving traffic, or
 * does it need restarting." `failed` means the process itself is broken (e.g. DB
 * unreachable) — a real liveness failure. `degraded` means the process is fine but
 * one or more networks are unhealthy. `healthy` means every configured network is
 * `synced`.
 */
export const ServiceStatusSchema = z.enum(["healthy", "degraded", "failed"]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const NetworkHealthSchema = z.object({
  chainId: z.number().int().positive(),
  isTestnet: z.boolean(),
  state: NetworkStateSchema,
  lastProcessedBlock: BlockNumberSchema,
  chainHeadBlock: BlockNumberSchema,
  blocksBehind: z.number().int().nonnegative(),
});
export type NetworkHealth = z.infer<typeof NetworkHealthSchema>;

/**
 * Feature support for the whole server — sits at the root of the health response,
 * not repeated per network, since whether this process implements the Socket.IO
 * layer at all is a property of the server, not of any one chain.
 */
export const IndexerCapabilitiesSchema = z.object({
  subscribe: z.boolean(),
});
export type IndexerCapabilities = z.infer<typeof IndexerCapabilitiesSchema>;

/**
 * GET /health — a single, universal, non-network-scoped endpoint (deliberately NOT
 * /<network>/health). Matches how virtually every piece of infra tooling (k8s
 * liveness/readiness probes, Docker HEALTHCHECK, load balancers, uptime monitors)
 * expects exactly one well-known health path per service instance, regardless of how
 * many networks/sub-resources it manages underneath.
 */
export const HealthResponseSchema = z.object({
  status: ServiceStatusSchema,
  /** The versioned API contract this instance implements (see ./version.ts) — a
   * "Self-hosted / Custom" wallet Data Source entry checks this for compatibility
   * before being accepted. */
  contractVersion: z.string(),
  capabilities: IndexerCapabilitiesSchema,
  networks: z.record(z.string(), NetworkHealthSchema),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

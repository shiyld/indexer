import { NETWORKS } from "@shiyld/shared";

export const DATABASE_URL = process.env.DATABASE_URL || "postgresql://shiyld:shiyld@localhost:5432/shiyld";

// Unset (not defaulted to a localhost URL) is a deliberate, meaningful state —
// it means "single-instance mode," the in-memory cache/Socket.IO adapter self-
// hosters running the plain `docker compose up` setup get by default. Only set
// this once you're actually running more than one replica.
export const REDIS_URL = process.env.REDIS_URL || undefined;

export const INDEXER_HTTP_PORT = Number(process.env.INDEXER_HTTP_PORT) || 4001;

export const INDEXER_ACCESS_MODE: "public" | "restricted" = process.env.INDEXER_ACCESS_MODE === "restricted" ? "restricted" : "public";
export const INDEXER_API_KEYS = (process.env.INDEXER_API_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);
export const INDEXER_RATE_LIMIT_PER_MINUTE = Number(process.env.INDEXER_RATE_LIMIT_PER_MINUTE) || 300;

export interface NetworkRuntimeConfig {
  chainId: number;
  rpcUrl: string;
}

/**
 * Which networks this instance actually watches — a comma-separated list of
 * slugs from @shiyld/shared's NETWORKS registry. Each network's RPC URL
 * defaults to that registry's free public endpoint (works out of the box, no
 * signup required); a self-hoster wanting a dedicated/paid provider overrides
 * per-network via RPC_URL_<SLUG_UPPERCASED_WITH_UNDERSCORES>, e.g.
 * RPC_URL_BASE_SEPOLIA. Defaults to every testnet Shiyld has a live deployment on.
 */
export function resolveNetworks(): NetworkRuntimeConfig[] {
  const slugs = (process.env.INDEXER_NETWORKS || "base-sepolia,arbitrum-sepolia,ethereum-sepolia")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);

  return slugs.map((slug) => {
    const network = NETWORKS[slug];
    if (!network) {
      throw new Error(`Unrecognized network slug "${slug}" in INDEXER_NETWORKS — see @shiyld/shared's NETWORKS registry for valid slugs.`);
    }
    const overrideEnvVar = `RPC_URL_${slug.toUpperCase().replace(/-/g, "_")}`;
    const rpcUrl = process.env[overrideEnvVar] || network.defaultRpcUrl;
    return { chainId: network.chainId, rpcUrl };
  });
}

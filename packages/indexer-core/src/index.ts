// Explicit named re-exports only — never `export *`. tsc's CJS output compiles
// `export *` to a dynamic __exportStar(require(...)) loop that Rollup's static
// named-export analysis can't see through, silently dropping values from bundled
// consumers (apps/wallet hit this exact bug during its Vite migration — see
// CLAUDE.md). Explicit re-exports compile to a form Rollup can statically verify.

export { API_CONTRACT_VERSION } from "./schema/version";

export { HexStringSchema, AddressSchema, Bytes32Schema, NetworkSlugSchema, BlockNumberSchema, Uint256StringSchema } from "./schema/common";

export { NetworkStateSchema, ServiceStatusSchema, NetworkHealthSchema, IndexerCapabilitiesSchema, HealthResponseSchema } from "./schema/health";
export type { NetworkState, ServiceStatus, NetworkHealth, IndexerCapabilities, HealthResponse } from "./schema/health";

export { PoolVerifiersSchema, PoolSchema, PoolsQuerySchema, PoolsResponseSchema } from "./schema/pools";
export type { PoolVerifiers, Pool, PoolsQuery, PoolsResponse } from "./schema/pools";

export { ProtocolContractSchema, ContractsResponseSchema } from "./schema/contracts";
export type { ProtocolContract, ContractsResponse } from "./schema/contracts";

export {
  MAX_EVENTS_BLOCK_RANGE,
  DepositEventSchema,
  TransferEventSchema,
  WithdrawalEventSchema,
  Transfer2EventSchema,
  Withdrawal2EventSchema,
  LeafInsertedEventSchema,
  PoolEventSchema,
  EventsQuerySchema,
  EventsResponseSchema,
} from "./schema/events";
export type {
  DepositEvent,
  TransferEvent,
  WithdrawalEvent,
  Transfer2Event,
  Withdrawal2Event,
  LeafInsertedEvent,
  PoolEvent,
  EventsQuery,
  EventsResponse,
} from "./schema/events";

export { MERKLE_TREE_DEPTH, MerkleProofResponseSchema } from "./schema/merkleProof";
export type { MerkleProofResponse } from "./schema/merkleProof";

export { createPool } from "./db/pool";
export { runMigrations, defaultMigrationsDir } from "./db/migrate";

export { getPools, getProtocolContracts } from "./registry/read";
export { seedRegistryFromSharedConstants } from "./registry/seed";
export type { SeedResult } from "./registry/seed";
export { RegistryWatcher } from "./registry/watcher";
export type { RegistrySnapshot, RegistryWatcherOptions } from "./registry/watcher";

export { withRetry } from "./listener/retry";
export { SHIELDED_POOL_EVENT_NAMES, parsePoolEvent } from "./listener/eventParser";
export type { ShieldedPoolEventName } from "./listener/eventParser";
export { createEthersPoolChainClient } from "./listener/chainClient";
export type { PoolChainClient } from "./listener/chainClient";
export { ingestPool } from "./listener/poolIngestion";
export type { PoolIngestionResult } from "./listener/poolIngestion";
export { NetworkListener, createNetworkListener } from "./listener/networkListener";
export type { NetworkListenerStatus, NetworkListenerDeps } from "./listener/networkListener";
export { MultiNetworkListener } from "./listener/multiNetworkListener";
export type { NetworkConfig, MultiNetworkListenerOptions } from "./listener/multiNetworkListener";

export { saveNetworkStatus, getPersistedNetworkStatuses } from "./listener/networkStatusStore";
export { startStatusPersistence } from "./listener/statusPersistence";

export { createMerkleTree, toHex32, fromHex } from "./merkle/tree";
export type { MerkleTreeInstance } from "./merkle/tree";
export { getPoseidon } from "./merkle/poseidon";
export type { Poseidon2 } from "./merkle/poseidon";
export { computeMerkleProof, LeafNotFoundError, MerkleLeafGapError } from "./merkle/proofService";

export { getEvents } from "./events/read";

export { computeServiceStatus, buildHealthResponse } from "./server/healthStatus";
export { createIndexerApp } from "./server/app";
export type { IndexerAppDeps } from "./server/app";

export type { CacheAdapter } from "./cache/adapter";
export { createMemoryCache } from "./cache/memoryCache";
export { createRedisCache } from "./cache/redisCache";
export type { RedisCacheAdapter } from "./cache/redisCache";
export { createCache } from "./cache/createCache";
export {
  poolsCacheKey,
  contractsCacheKey,
  merkleProofCacheKey,
  getPoolsCached,
  getProtocolContractsCached,
  computeMerkleProofCached,
} from "./cache/cachedReads";

export { poolRoom } from "./realtime/emitter";
export type { RealtimeEmitter } from "./realtime/emitter";
export { attachSocketServer } from "./realtime/socketServer";
export type { IndexerSocketServer, CreateSocketServerOptions } from "./realtime/socketServer";
export { createRedisRealtimeEmitter } from "./realtime/redisEmitter";
export type { RedisRealtimeEmitter } from "./realtime/redisEmitter";

export { createAccessControlConfig } from "./hardening/accessControl";
export type { AccessControlConfig } from "./hardening/accessControl";
export { createAccessModeMiddleware } from "./hardening/accessMode";
export { createSocketAuthMiddleware } from "./hardening/socketAuth";
export { createRateLimitMiddleware } from "./hardening/rateLimit";

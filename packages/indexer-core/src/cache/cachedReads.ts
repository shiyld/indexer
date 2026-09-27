import type { Pool as PgPool } from "pg";
import type { CacheAdapter } from "./adapter";
import { getPools, getProtocolContracts } from "../registry/read";
import { computeMerkleProof } from "../merkle/proofService";
import type { Pool as PoolRecord } from "../schema/pools";
import type { ProtocolContract } from "../schema/contracts";
import type { MerkleProofResponse } from "../schema/merkleProof";

/** Matches RegistryWatcher's own default poll interval — a safety-net TTL, not
 * the primary invalidation path. The real invalidation path is calling
 * `cache.del()` directly (see poolsCacheKey/contractsCacheKey below) the moment a
 * registry write is observed — e.g. a RegistryWatcher's onChange callback, once
 * apps/indexer wires the two together. */
const REGISTRY_TTL_SECONDS = 30;

/** Long — safe, because the key itself changes when the tree grows (see below),
 * not because the data is assumed stable for an hour. */
const MERKLE_PROOF_TTL_SECONDS = 3600;

export function poolsCacheKey(chainId: number, asset?: string): string {
  return `pools:${chainId}:${asset ?? "*"}`;
}

export function contractsCacheKey(chainId: number): string {
  return `contracts:${chainId}`;
}

/** Embeds treeSize directly in the key — a later leaf insertion naturally
 * produces a different key rather than needing separate staleness bookkeeping,
 * exactly the design decided in CLAUDE.md: "a later insertion can never serve a
 * stale proof." */
export function merkleProofCacheKey(chainId: number, poolAddress: string, leafIndex: number, treeSize: number): string {
  return `merkle-proof:${chainId}:${poolAddress}:${leafIndex}:${treeSize}`;
}

export async function getPoolsCached(cache: CacheAdapter, db: PgPool, chainId: number, asset?: string): Promise<PoolRecord[]> {
  const key = poolsCacheKey(chainId, asset);
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached) as PoolRecord[];

  const pools = await getPools(db, chainId, asset);
  await cache.set(key, JSON.stringify(pools), REGISTRY_TTL_SECONDS);
  return pools;
}

export async function getProtocolContractsCached(cache: CacheAdapter, db: PgPool, chainId: number): Promise<ProtocolContract[]> {
  const key = contractsCacheKey(chainId);
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached) as ProtocolContract[];

  const contracts = await getProtocolContracts(db, chainId);
  await cache.set(key, JSON.stringify(contracts), REGISTRY_TTL_SECONDS);
  return contracts;
}

/**
 * A cheap, indexed COUNT runs first so a cache hit never pays for a full tree
 * rebuild (the expensive part — Poseidon hashing over every leaf) just to learn
 * the current treeSize.
 */
export async function computeMerkleProofCached(
  cache: CacheAdapter,
  db: PgPool,
  chainId: number,
  poolAddress: string,
  leafIndex: number,
): Promise<MerkleProofResponse> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*) FROM merkle_leaves WHERE chain_id = $1 AND pool_address = $2`,
    [chainId, poolAddress],
  );
  const treeSize = Number(rows[0].count);
  const key = merkleProofCacheKey(chainId, poolAddress, leafIndex, treeSize);

  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached) as MerkleProofResponse;

  const proof = await computeMerkleProof(db, chainId, poolAddress, leafIndex);
  await cache.set(key, JSON.stringify(proof), MERKLE_PROOF_TTL_SECONDS);
  return proof;
}

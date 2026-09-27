import express, { type Application, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import type { Pool as PgPool } from "pg";
import { networkBySlug } from "@shiyld/shared";
import { getPools, getProtocolContracts } from "../registry/read";
import { getEvents } from "../events/read";
import { computeMerkleProof, LeafNotFoundError, MerkleLeafGapError } from "../merkle/proofService";
import { getPoolsCached, getProtocolContractsCached, computeMerkleProofCached } from "../cache/cachedReads";
import type { CacheAdapter } from "../cache/adapter";
import { createAccessControlConfig, type AccessControlConfig } from "../hardening/accessControl";
import { createAccessModeMiddleware } from "../hardening/accessMode";
import { createRateLimitMiddleware } from "../hardening/rateLimit";
import { PoolsQuerySchema, PoolsResponseSchema } from "../schema/pools";
import { ContractsResponseSchema } from "../schema/contracts";
import { EventsQuerySchema, EventsResponseSchema } from "../schema/events";
import { MerkleProofResponseSchema } from "../schema/merkleProof";
import type { NetworkListenerStatus } from "../listener/networkListener";
import { buildHealthResponse } from "./healthStatus";

const DEFAULT_RATE_LIMIT_PER_MINUTE = 300;

export interface IndexerAppDeps {
  db: PgPool;
  /** Injected rather than a concrete MultiNetworkListener — keeps the REST layer
   * testable without a real listener/chain running, and lets apps/indexer wire in
   * whatever orchestrator it actually uses. May return a plain array (the
   * combined single-process mode's in-memory listener) or a Promise (the split
   * server mode, which reads network_status from Postgres — there's no
   * in-process listener to ask synchronously when N stateless replicas share
   * one singleton worker). */
  getNetworkStatuses: () => NetworkListenerStatus[] | Promise<NetworkListenerStatus[]>;
  /** Set once Socket.IO is actually attached (item #9) — a bare REST-only
   * deployment correctly reports capabilities.subscribe: false rather than
   * claiming a feature that isn't wired up. */
  capabilities?: { subscribe: boolean };
  /** Optional — omitting it means every read hits Postgres directly (correct,
   * just not accelerated), the same "cache is a pure optimization" property this
   * whole project already holds for the indexer as a whole relative to the chain. */
  cache?: CacheAdapter;
  /** Defaults to fully public, no API key required — see hardening/accessControl.ts.
   * Shared with attachSocketServer's own accessControl option so REST and the
   * socket layer can never drift into inconsistent lockdown states. */
  accessControl?: AccessControlConfig;
  /** Requests per minute, per IP (or per API key in restricted mode). */
  rateLimitPerMinute?: number;
}

function resolveNetworkOr404(req: Request, res: Response): { chainId: number } | null {
  const network = networkBySlug(req.params.network);
  if (!network) {
    res.status(404).json({ error: `Unrecognized network "${req.params.network}"` });
    return null;
  }
  return { chainId: network.chainId };
}

/**
 * Builds the versioned indexer REST API (see CLAUDE.md's "Indexer: Full Design &
 * Public Distribution Plan" for the full contract). Every response is validated
 * against its zod schema right before being sent — defense in depth, catching a
 * DB-row-mapping bug immediately instead of silently serving malformed data to a
 * client that trusts this contract.
 *
 * Hardening (CORS, helmet, access-mode auth, rate limiting) is applied here as
 * real middleware, not left for a caller to bolt on — but every knob defaults to
 * the fully-open, single-tenant shape most self-hosters actually want: CORS open
 * to any origin (no cookies/session auth is ever involved, unlike apps/api's own
 * private admin/faucet endpoints, which keep a strict allowlist), access mode
 * "public" (no API key required), a generous default rate limit.
 */
export function createIndexerApp(deps: IndexerAppDeps): Application {
  const {
    db,
    getNetworkStatuses,
    capabilities = { subscribe: false },
    cache,
    accessControl = createAccessControlConfig(),
    rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE,
  } = deps;
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: "*" }));
  app.use(createRateLimitMiddleware(rateLimitPerMinute));

  // GET /health — universal, non-network-scoped (deliberately not /:network/health).
  // Deliberately NOT behind the access-mode gate below, even in "restricted" mode
  // — a k8s liveness/readiness probe or uptime monitor needs to reach this
  // without knowing an API key, and it reveals nothing an operator would want
  // gated (no note data, no user data, just sync status).
  app.get("/health", async (_req: Request, res: Response) => {
    let dbHealthy = true;
    try {
      await db.query("SELECT 1");
    } catch {
      dbHealthy = false;
    }
    const body = buildHealthResponse(dbHealthy, await getNetworkStatuses(), capabilities);
    res.json(body);
  });

  const network = express.Router({ mergeParams: true });
  network.use(createAccessModeMiddleware(accessControl));
  app.use("/:network", network);

  network.get("/pools", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = resolveNetworkOr404(req, res);
      if (!resolved) return;
      const query = PoolsQuerySchema.safeParse(req.query);
      if (!query.success) return void res.status(400).json({ error: query.error.message });

      const pools = cache
        ? await getPoolsCached(cache, db, resolved.chainId, query.data.asset)
        : await getPools(db, resolved.chainId, query.data.asset);
      res.json(PoolsResponseSchema.parse({ pools }));
    } catch (err) {
      next(err);
    }
  });

  network.get("/contracts", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = resolveNetworkOr404(req, res);
      if (!resolved) return;
      const contracts = cache
        ? await getProtocolContractsCached(cache, db, resolved.chainId)
        : await getProtocolContracts(db, resolved.chainId);
      res.json(ContractsResponseSchema.parse({ contracts }));
    } catch (err) {
      next(err);
    }
  });

  network.get("/pools/:poolAddress/events", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = resolveNetworkOr404(req, res);
      if (!resolved) return;

      const query = EventsQuerySchema.safeParse({
        fromBlock: Number(req.query.fromBlock),
        toBlock: Number(req.query.toBlock),
      });
      if (!query.success) return void res.status(400).json({ error: query.error.message });

      const events = await getEvents(db, resolved.chainId, req.params.poolAddress, query.data.fromBlock, query.data.toBlock);
      res.json(EventsResponseSchema.parse({ events }));
    } catch (err) {
      next(err);
    }
  });

  network.get("/pools/:poolAddress/merkle-proof/:leafIndex", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = resolveNetworkOr404(req, res);
      if (!resolved) return;

      const leafIndex = Number(req.params.leafIndex);
      if (!Number.isInteger(leafIndex) || leafIndex < 0) {
        return void res.status(400).json({ error: "leafIndex must be a non-negative integer" });
      }

      const proof = cache
        ? await computeMerkleProofCached(cache, db, resolved.chainId, req.params.poolAddress, leafIndex)
        : await computeMerkleProof(db, resolved.chainId, req.params.poolAddress, leafIndex);
      res.json(MerkleProofResponseSchema.parse(proof));
    } catch (err) {
      if (err instanceof LeafNotFoundError) return void res.status(404).json({ error: err.message });
      if (err instanceof MerkleLeafGapError) return void res.status(500).json({ error: err.message });
      next(err);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[indexer-core server] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

import { Pool } from "pg";

/**
 * Creates a pg.Pool from a connection string. No default/fallback baked in here,
 * unlike apps/api's own DATABASE_URL convenience default — indexer-core is a shared
 * library consumed by multiple entrypoints (apps/api, apps/indexer), each of which
 * owns its own env-var resolution/defaulting.
 */
export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

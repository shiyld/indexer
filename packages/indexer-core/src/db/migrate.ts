import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_TABLE = "schema_migrations";

/**
 * The bundled migrations directory, resolved relative to this compiled module — works
 * both from source (ts-jest) and from a real published/installed dist/ build, since
 * `pnpm run build`'s copy-migrations step places the .sql files at the equivalent
 * dist/db/migrations path.
 */
export function defaultMigrationsDir(): string {
  return join(__dirname, "migrations");
}

/**
 * Applies every .sql file under `migrationsDir` that hasn't already run, in
 * filename order (0001_*, 0002_*, ... — zero-padded so lexical sort == numeric
 * order), tracked in a `schema_migrations` table. Each file runs inside its own
 * transaction, so a failure partway through one migration never leaves the schema
 * half-applied.
 *
 * Deliberately NOT the idempotent CREATE-TABLE-IF-NOT-EXISTS pattern apps/api's own
 * SCHEMA_SQL uses — a public, versioned, self-hosted product needs real forward
 * migrations across upgrades (add a column, backfill a value), not just "recreate if
 * missing." See CLAUDE.md's "Indexer: Full Design & Public Distribution Plan."
 *
 * Returns the list of migration filenames that were newly applied this call (empty
 * if the schema was already current).
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  const applied = new Set(rows.map((r) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

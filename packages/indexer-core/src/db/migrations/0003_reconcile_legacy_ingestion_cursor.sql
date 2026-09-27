-- One-time reconciliation for the same historical drift 0001_init.sql's own comment
-- documents: apps/api's old bespoke SCHEMA_SQL (before indexer-core was embedded)
-- created an ingestion_cursor table shaped for pools only, with the column named
-- pool_address. The current schema tracks pools AND protocol contracts through this
-- one table (see 0001_init.sql's own comment on it), so the column is now named
-- address — but IF NOT EXISTS on CREATE TABLE (0001) silently keeps whatever shape
-- an already-existing table has, it can't rename a column. Without this, every real
-- query against ingestion_cursor (see listener/poolIngestion.ts) fails with
-- "column address does not exist" on any environment carrying this specific
-- historical drift (confirmed live on Base Sepolia staging 2026-09-21).
--
-- Guarded, not a plain ALTER: a genuinely fresh install's ingestion_cursor already
-- has the column named `address` from 0001 directly, so this must be a safe no-op
-- there, not an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_cursor' AND column_name = 'pool_address'
  ) THEN
    ALTER TABLE ingestion_cursor RENAME COLUMN pool_address TO address;
  END IF;
END $$;

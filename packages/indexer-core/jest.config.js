// Run via `pnpm run test` (jest --runInBand), not `jest` directly — every DB-touching
// test file (db/migrate.test.ts, registry/seed.test.ts, registry/watcher.test.ts)
// resets the same shared TEST_DATABASE_URL in its own beforeEach, and Jest's default
// per-file parallel workers would race those resets against each other (one file's
// DROP SCHEMA wiping tables mid-test for another). Serializing is the correct fix,
// not a workaround — these tests genuinely share one external resource.
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
};

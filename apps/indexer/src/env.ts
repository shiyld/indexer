// Must be the first import in every entrypoint (index.ts/server.ts/worker.ts).
// ES module imports are hoisted — every other module's top-level code (including
// config.ts's `process.env.X` reads) runs before any statement in the importing
// file executes, regardless of source order. Since config.ts reads env vars at
// module-load time, dotenv.config() has to happen in a module imported first, not
// as a same-file statement after other imports — this exact bug already bit
// apps/api once (see its own env.ts).
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

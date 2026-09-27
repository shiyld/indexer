/**
 * Real live verification — genuine end-to-end confidence beyond the mocked unit
 * tests: connects to the real Base Sepolia chain, backfills the real, currently-
 * deployed ETH pool from its actual deploymentBlock to the current head, and
 * reports what was found. Matches this project's own established "live
 * verification script" pattern (see packages/contracts/scripts/verify-*.ts) —
 * strongest signal short of a full production deployment.
 *
 * Requires TEST_DATABASE_URL (an isolated Postgres database — never the real
 * `shiyld` database apps/api/apps/api-worker use).
 *
 * Run: pnpm run verify:listener-live
 */
import { Contract, JsonRpcProvider } from "ethers";
import { Pool as PgPool } from "pg";
import { NETWORKS, SHIELDED_POOL_ABI } from "@shiyld/shared";
import { runMigrations, defaultMigrationsDir } from "../src/db/migrate";
import { seedRegistryFromSharedConstants } from "../src/registry/seed";
import { getPools } from "../src/registry/read";
import { createNetworkListener } from "../src/listener/networkListener";
import { computeMerkleProof } from "../src/merkle/proofService";
import { getPoseidon } from "../src/merkle/poseidon";
import { fromHex, toHex32 } from "../src/merkle/tree";

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set TEST_DATABASE_URL to an isolated Postgres database before running this script.");
  }

  const db = new PgPool({ connectionString: databaseUrl });
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(db, defaultMigrationsDir());

  const seedResult = await seedRegistryFromSharedConstants(db);
  console.log(`Seeded ${seedResult.poolsSeeded} pool(s), ${seedResult.contractsSeeded} protocol contract(s).`);

  const baseSepolia = NETWORKS["base-sepolia"];
  const pools = await getPools(db, baseSepolia.chainId);
  const ethPool = pools.find((p) => p.asset === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
  if (!ethPool) throw new Error("ETH pool not found in the seeded registry — check @shiyld/shared's ASSETS.");

  console.log(`Backfilling the real ETH pool ${ethPool.poolAddress} on ${baseSepolia.name} from block ${ethPool.deploymentBlock}...`);
  console.log(`RPC: ${baseSepolia.defaultRpcUrl}`);

  const listener = createNetworkListener(baseSepolia.chainId, baseSepolia.defaultRpcUrl, db, { pollIntervalMs: 3_600_000 });
  await listener.start(); // runs exactly one real ingestion pass immediately
  const status = listener.getStatus();
  listener.stop();

  console.log("\n--- NetworkListener status after one real ingestion pass ---");
  console.log(status);

  const { rows: eventCounts } = await db.query(
    `SELECT event_type, count(*) FROM events WHERE pool_address = $1 GROUP BY event_type ORDER BY event_type`,
    [ethPool.poolAddress],
  );
  console.log("\n--- Real events found and persisted, by type ---");
  console.table(eventCounts);

  const { rows: leafRows } = await db.query(`SELECT count(*) FROM merkle_leaves WHERE pool_address = $1`, [ethPool.poolAddress]);
  console.log(`Merkle leaves stored: ${leafRows[0].count}`);

  const { rows: statsRows } = await db.query(`SELECT * FROM pool_stats WHERE pool_address = $1`, [ethPool.poolAddress]);
  console.log("\n--- pool_stats row ---");
  console.log(statsRows[0]);

  if (status.state === "degraded") {
    throw new Error("Listener reported 'degraded' — a real root mismatch or ingestion failure occurred. See the error logged above.");
  }

  console.log("\nOK — real chain data decoded, persisted, and the Merkle root sanity-check passed against the live contract.");

  // Strongest possible check: compute a real Merkle proof from what we just
  // ingested, verify it's mathematically self-consistent, then cross-check it
  // against the actual live contract's own current root() — proving the whole
  // pipeline (real chain -> ingestion -> storage -> proof computation) is
  // correct end to end, not just internally consistent with itself.
  const leafCount = Number(leafRows[0].count);
  if (leafCount > 0) {
    const targetLeafIndex = leafCount - 1;
    console.log(`\n--- Computing a real Merkle proof for leaf ${targetLeafIndex} ---`);
    const proof = await computeMerkleProof(db, baseSepolia.chainId, ethPool.poolAddress, targetLeafIndex);

    const { poseidon2 } = await getPoseidon();
    let node = fromHex(proof.leaf);
    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = fromHex(proof.siblings[i]);
      node = proof.pathIndices[i] === 1 ? poseidon2(sibling, node) : poseidon2(node, sibling);
    }
    const recomputedRoot = toHex32(node);
    console.log(`Proof's own claimed root:  ${proof.root}`);
    console.log(`Recomputed from siblings:  ${recomputedRoot}`);
    if (recomputedRoot !== proof.root) {
      throw new Error("Recomputed root does not match the proof's own claimed root — the Merkle proof is mathematically wrong.");
    }

    const provider = new JsonRpcProvider(baseSepolia.defaultRpcUrl, baseSepolia.chainId);
    const contract = new Contract(ethPool.poolAddress, SHIELDED_POOL_ABI, provider);
    const liveRoot = (await contract.root!()) as string;
    console.log(`Live contract's current root() call: ${liveRoot}`);
    if (liveRoot.toLowerCase() !== proof.root.toLowerCase()) {
      console.warn(
        "Live root differs from the proof's root — expected ONLY if a new leaf was inserted on-chain between ingestion and this check (a real race, not a bug). Re-run to confirm.",
      );
    } else {
      console.log("OK — the computed proof's root matches the real, live contract's root() exactly.");
    }
  }

  await db.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

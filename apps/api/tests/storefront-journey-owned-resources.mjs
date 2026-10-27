import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { constructionOnlyEnvironment } from "./nest-construction-only.guards.mjs";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { createDisposableRedis } from "./local-disposable-redis.mjs";
import { inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
import { assertFreshJourneyRuntimeArtifacts } from "./storefront-journey-compiled-artifact.mjs";
import { installCheckoutSessionVersionTrigger } from "./checkout-session-version-trigger.mjs";

/** Shared owned-resource setup for separate commerce/LLM workers. No ambient
 * dotenv, migration download, partial business schema or auth fixture. */
export async function createOwnedStorefrontJourneyResources() {
  assertFreshJourneyRuntimeArtifacts();
  const apiRoot = fileURLToPath(new URL("../", import.meta.url)), workspaceRoot = resolve(apiRoot, "../..");
  inspectNativePrismaClient(apiRoot);
  for (const root of [apiRoot, workspaceRoot]) for (const name of ["prisma.config.ts", "prisma.config.js", "prisma.config.mjs", "prisma.config.cjs", "prisma.config.mts", "prisma.config.cts",
    ".config/prisma.ts", ".config/prisma.js", ".config/prisma.mjs", ".config/prisma.cjs"]) {
    const path = resolve(root, name);
    if (path === resolve(apiRoot, "prisma.config.ts")) assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"),
      "90fff1aba794a45710e913c8297df44c739ed8e06bf457ec0809fc65c723e34d", "journey_prisma_config_requires_review");
    else assert.equal(existsSync(path), false, "journey_unreviewed_prisma_config_forbidden");
  }
  let db, redis, closed = false;
  async function close() {
    if (closed) return; closed = true;
    const errors = [];
    for (const owned of [redis, db]) if (owned) {
      try { await owned.dispose(); assert.deepEqual(owned.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "journey_owned_resources_cleanup_failed");
  }
  try {
    db = await createDisposablePostgres({ transport: "loopback-exec" }); redis = await createDisposableRedis();
    const require = createRequire(new URL("../package.json", import.meta.url)), packagePath = require.resolve("prisma/package.json");
    const metadata = JSON.parse(readFileSync(packagePath, "utf8")), bin = metadata.bin?.prisma;
    assert.ok(metadata.name === "prisma" && typeof bin === "string" && bin.length && !bin.includes("\0") && !isAbsolute(bin), "journey_declared_prisma_cli_required");
    const root = dirname(packagePath), cli = resolve(root, bin), inPackage = relative(root, cli);
    assert.ok(inPackage && inPackage !== ".." && !inPackage.startsWith("..\\") && !inPackage.startsWith("../") && !isAbsolute(inPackage) && existsSync(cli) && statSync(cli).isFile(), "journey_cli_must_stay_in_package");
    const engineEntry = createRequire(cli).resolve("@prisma/engines"), schemaEngine = resolve(dirname(engineEntry), "..", "schema-engine-windows.exe");
    for (const file of [cli, engineEntry, schemaEngine]) {
      const path = relative(workspaceRoot, file);
      assert.ok(path !== ".." && !path.startsWith("..\\") && !path.startsWith("../") && !isAbsolute(path) && existsSync(file), "journey_cached_local_cli_engine_required");
    }
    const diff = await promisify(execFile)(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
      cli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: apiRoot, env: { ...constructionOnlyEnvironment(process.env), DATABASE_URL: db.prismaUrl }, windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000 });
    assert.ok(diff.stdout.includes("CREATE TABLE") && diff.stdout.includes('"merchants"') && diff.stdout.includes('"buyer_accounts"'), "journey_full_schema_sql_required");
    await db.sql(diff.stdout);
    await installCheckoutSessionVersionTrigger(db);
    assert.ok(Number(await db.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")) > 100);
    await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');
      CREATE TABLE synthetic_storefront_journey_binding (run_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
        session_id TEXT NOT NULL, api_origin TEXT NOT NULL, postgres_run_id TEXT NOT NULL, redis_run_id TEXT NOT NULL);`);
    return Object.freeze({ db, redis, tree: "dist-test", runId: randomUUID(), merchantId: randomUUID(), buyerId: randomUUID(), close,
      workerArguments() { return [db.prismaUrl, db.runId, redis.url, redis.runId, "dist-test", this.runId, this.merchantId, this.buyerId]; } });
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "journey_resource_setup_and_cleanup_failed"); } throw error; }
}

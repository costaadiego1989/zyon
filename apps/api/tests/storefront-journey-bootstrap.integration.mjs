import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { constructionOnlyEnvironment } from "./nest-construction-only.guards.mjs";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { createDisposableRedis } from "./local-disposable-redis.mjs";
import { inspectNativePrismaClient, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";
import { inspectOriginalJourneyBudget } from "./storefront-journey-original-budget.mjs";
import { assertFreshJourneyRuntimeArtifacts, journeyRuntimeArtifactEntries } from "./storefront-journey-compiled-artifact.mjs";

const flags = ["--local-disposable", "--prisma-loopback-exec", "--compiled-test-artifact", "--bootstrap-only", "--no-real-provider"];
assert.deepEqual(process.argv.slice(2).sort(), [...flags].sort(), "explicit_owned_journey_bootstrap_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url)), tree = "dist-test";
assertFreshJourneyRuntimeArtifacts(); // fresh emission, not a claimed full typecheck
for (const entry of journeyRuntimeArtifactEntries()) assert.ok(existsSync(new URL(`../${tree}/${entry}`, import.meta.url)), "fresh_canonical_compiled_artifacts_required");
inspectNativePrismaClient(apiRoot);
const workspaceRoot = resolve(apiRoot, "../..");
// Prisma's generated client metadata plus CLI's conventional dotenv locations
// must remain absent. Never load an unknown repo config to discover its effects.
for (const root of [apiRoot, workspaceRoot]) for (const name of ["prisma.config.ts", "prisma.config.js", "prisma.config.mjs", "prisma.config.cjs", "prisma.config.mts", "prisma.config.cts",
  ".config/prisma.ts", ".config/prisma.js", ".config/prisma.mjs", ".config/prisma.cjs"]) {
  const configPath = resolve(root, name);
  if (configPath === resolve(apiRoot, "prisma.config.ts")) {
    // Reviewed actual source: defineConfig({schema,migrations.path}) ONLY, no
    // dotenv/imported project bootstrap. Refuse any change before CLI execution.
    assert.equal(createHash("sha256").update(readFileSync(configPath)).digest("hex"),
      "90fff1aba794a45710e913c8297df44c739ed8e06bf457ec0809fc65c723e34d", "journey_prisma_cli_config_changed_requires_review");
  } else assert.equal(existsSync(configPath), false, "journey_unreviewed_prisma_cli_config_forbidden");
}
const before = inspectOriginalJourneyBudget(); assert.equal(before.attemptedCalls, 12); assert.equal(before.remainingCalls, 48);
const runId = randomUUID(), merchantId = randomUUID(), buyerId = randomUUID();
let db, redis, child, failure, result, stdout = "", stderr = "";
const stage = value => console.log("JOURNEY_BOOTSTRAP_STAGE " + JSON.stringify(value));
try {
  db = await createDisposablePostgres({ transport: "loopback-exec" }); redis = await createDisposableRedis();
  stage({ stage: "owned_resources_created", providerCalls: 0 });
  // Full current Prisma model, not a handwritten subset hiding missing tables.
  const require = createRequire(new URL("../package.json", import.meta.url));
  // The package root exports a types entry in this installed Prisma version,
  // not its CLI. Resolve the declared executable without importing the package.
  const prismaPackagePath = require.resolve("prisma/package.json"), prismaPackage = JSON.parse(readFileSync(prismaPackagePath, "utf8"));
  const cliBin = prismaPackage.bin?.prisma;
  assert.ok(prismaPackage.name === "prisma" && typeof cliBin === "string" && cliBin.length > 0 && !cliBin.includes("\0") && !isAbsolute(cliBin),
    "journey_local_prisma_declared_cli_required");
  const prismaPackageRoot = dirname(prismaPackagePath), cli = resolve(prismaPackageRoot, cliBin), cliRelative = relative(prismaPackageRoot, cli);
  assert.ok(cliRelative !== "" && cliRelative !== ".." && !cliRelative.startsWith("..\\") && !cliRelative.startsWith("../") && !isAbsolute(cliRelative)
    && existsSync(cli) && statSync(cli).isFile(), "journey_local_prisma_declared_cli_must_stay_in_package");
  const enginesEntry = createRequire(cli).resolve("@prisma/engines"), schemaEngine = resolve(dirname(enginesEntry), "..", "schema-engine-windows.exe");
  for (const file of [cli, enginesEntry, schemaEngine]) {
    const path = relative(workspaceRoot, file);
    assert.ok(path !== ".." && !path.startsWith("..\\") && !isAbsolute(path) && existsSync(file), "journey_cached_local_prisma_cli_engine_required_no_download");
  }
  const diff = await promisify(execFile)(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    cli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    { cwd: apiRoot, env: { ...constructionOnlyEnvironment(process.env), DATABASE_URL: db.prismaUrl }, windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000 });
  assert.ok(diff.stdout.includes("CREATE TABLE") && diff.stdout.includes('"merchants"') && diff.stdout.includes('"buyer_accounts"'), "canonical_full_schema_sql_required");
  await db.sql(diff.stdout);
  assert.ok(Number(await db.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")) > 100, "complete_canonical_schema_required");
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');
    CREATE TABLE synthetic_storefront_journey_binding (run_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
      session_id TEXT NOT NULL, api_origin TEXT NOT NULL, postgres_run_id TEXT NOT NULL, redis_run_id TEXT NOT NULL);`);
  stage({ stage: "canonical_schema_applied", migrationHistoryValidated: false, providerCalls: 0 });
  child = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    fileURLToPath(new URL("./storefront-journey-bootstrap.worker.mjs", import.meta.url)), db.prismaUrl, db.runId, redis.url, redis.runId, tree, runId, merchantId, buyerId],
    { cwd: apiRoot, env: constructionOnlyEnvironment(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let offset = 0, overLimit = false;
  child.stdout.on("data", chunk => {
    stdout += chunk;
    if (stdout.length + stderr.length > 4_000_000) { overLimit = true; child.kill(); return; }
    const lines = stdout.slice(offset).split(/\r?\n/);
    for (const line of lines.slice(0, -1)) {
      if (line.startsWith("JOURNEY_BOOTSTRAP_STAGE ") || line.startsWith("JOURNEY_BOOTSTRAP_RESULT ")) process.stdout.write(line + "\n");
      // A structured FAILURE is emitted only after child cleanup was attempted;
      // terminate a failed partial DI process if unmanaged handles remain. This
      // can never satisfy the natural-exit0 success gate.
      if (line.startsWith("JOURNEY_BOOTSTRAP_FAILURE ")) child.kill();
    }
    offset = stdout.length - lines.at(-1).length;
  });
  child.stderr.on("data", chunk => { stderr += chunk; if (stdout.length + stderr.length > 4_000_000) { overLimit = true; child.kill(); } });
  let timer;
  const outcome = await Promise.race([new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error("journey_owned_bootstrap_child_deadline")), 120_000); })]).finally(() => clearTimeout(timer));
  assert.equal(overLimit, false); assert.equal(outcome.code, 0, "canonical_app_init_listen_or_cleanup_failed"); assert.equal(outcome.signal, null);
  const results = stdout.split(/\r?\n/).filter(line => line.startsWith("JOURNEY_BOOTSTRAP_RESULT "));
  assert.equal(results.length, 1); result = JSON.parse(results[0].slice("JOURNEY_BOOTSTRAP_RESULT ".length));
  assert.equal(result.canonicalAppModule, true); assert.equal(result.lifecycleInit, true); assert.equal(result.httpListen, true);
  assert.equal(result.realCanonicalPrincipal, true); assert.equal(result.actualSqlRedisBindings, true); assert.equal(result.providerCalls, 0);
  assert.equal(result.repositoryOverrides, false); assert.equal(result.authOverrides, false); assert.equal(result.paidJourneyValidated, false);
  assert.equal(result.appClosed, true);
} catch (error) {
  const failures = stdout.split(/\r?\n/).filter(line => line.startsWith("JOURNEY_BOOTSTRAP_FAILURE "));
  for (const line of failures) process.stderr.write(line + "\n");
  // Child stdout/stderr may contain generated credentials in unrelated library
  // logs. Never dump them. Structured failure below contains fixed safe metadata.
  failure = error;
} finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(child); } catch (error) { cleanup.push(error); }
  for (const owned of [redis, db]) {
    if (!owned) continue;
    try { await owned.dispose(); assert.deepEqual(owned.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
    catch (error) { cleanup.push(error); }
  }
  const after = inspectOriginalJourneyBudget();
  assert.equal(after.attemptedCalls, before.attemptedCalls, "bootstrap_must_not_consume_approved_llm_calls");
  if (cleanup.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanup], "journey_owned_resource_cleanup_failed");
}
if (failure) throw failure;
console.log(JSON.stringify({ ...result, fullCanonicalSchema: true, disposablePostgres: true, disposableRedis: true,
  cleanupRemaining: 0, approvedLlmCallsBefore: before.attemptedCalls, approvedLlmCallsAfter: before.attemptedCalls }));

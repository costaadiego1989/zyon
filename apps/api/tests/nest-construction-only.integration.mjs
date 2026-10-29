import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertConstructionOnlyFlags, constructionOnlyEnvironment, constructionOnlyArtifactEntries } from "./nest-construction-only.guards.mjs";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { createDisposableRedis } from "./local-disposable-redis.mjs";
import { inspectNativePrismaClient, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

// All expensive/client/container work is below the exact explicit opt-ins.
const artifactTree = assertConstructionOnlyFlags(process.argv.slice(2));
const apiRoot = fileURLToPath(new URL("../", import.meta.url));
for (const entry of constructionOnlyArtifactEntries(artifactTree)) {
  assert.ok(existsSync(new URL(`../${artifactTree}/${entry}`, import.meta.url)), "compiled_app_module_required_no_source_loader");
}
console.log("NEST_CONSTRUCTION_ARTIFACT " + JSON.stringify({ artifactTree, fallback: false }));
inspectNativePrismaClient(apiRoot);
let db, redis, worker, closed, failure, resultEvidence;
let stdout = "", stderr = "";
const started = performance.now();
try {
  db = await createDisposablePostgres({ transport: "loopback-exec" });
  redis = await createDisposableRedis();
  assert.match(db.runId, /^[a-f0-9-]{36}$/);
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  worker = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    fileURLToPath(new URL("./nest-construction-only.worker.mjs", import.meta.url)), db.prismaUrl, db.runId, redis.url, redis.runId, artifactTree],
  { cwd: apiRoot, env: constructionOnlyEnvironment(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let tooLarge = false, stageOffset = 0;
  const collect = target => chunk => {
    if (stdout.length + stderr.length + chunk.length > 2_000_000) { tooLarge = true; worker.kill(); return; }
    if (target === "out") {
      stdout += chunk;
      const lines = stdout.slice(stageOffset).split(/\r?\n/);
      for (const line of lines.slice(0, -1)) {
        if (line.startsWith("NEST_CONSTRUCTION_STAGE ") || line.startsWith("NEST_CONSTRUCTION_RESULT ")) process.stdout.write(line + "\n");
      }
      stageOffset = stdout.length - lines.at(-1).length;
    }
    else {
      stderr += chunk;
      // Failed partial DI may leave constructor-created clients alive. This
      // explicit failure is never passing proof; terminate only our child.
      if (stderr.includes("NEST_CONSTRUCTION_FAILURE ")) worker.kill();
    }
  };
  worker.stdout.on("data", collect("out")); worker.stderr.on("data", collect("err"));
  closed = new Promise((resolve, reject) => { worker.once("error", reject); worker.once("close", (code, signal) => resolve({ code, signal })); });
  let timer, outcome;
  try {
    outcome = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("construction_child_deadline_exceeded")), 90_000); })]);
  } finally { clearTimeout(timer); }
  assert.equal(tooLarge, false, "construction_worker_output_limit");
  assert.equal(outcome.code, 0, "canonical_nest_construction_failed"); assert.equal(outcome.signal, null);
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith("NEST_CONSTRUCTION_RESULT "));
  assert.equal(lines.length, 1, "single_construction_result_required");
  resultEvidence = JSON.parse(lines[0].slice("NEST_CONSTRUCTION_RESULT ".length));
  assert.equal(resultEvidence.constructionOnly, true); assert.equal(resultEvidence.lifecycleInit, false);
  assert.equal(resultEvidence.artifactTree, artifactTree);
  assert.equal(resultEvidence.httpListen, false); assert.equal(resultEvidence.providerOverrides, false);
  assert.equal(resultEvidence.repositoryInstances, "real"); assert.equal(resultEvidence.quotaDependency, "resolved");
  assert.equal(resultEvidence.appClosed, true); assert.equal(resultEvidence.rawRedisClosed, true);
  assert.equal(resultEvidence.providerCalls, 0); assert.equal(resultEvidence.syntheticProviderConfig, true);
  assert.equal(resultEvidence.redisCleanup.physicalCloseAwaited, true);
  assert.equal(resultEvidence.redisCleanup.runtimeShutdownValidated, false);
  assert.equal(await db.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"), "1",
    "construction_must_not_create_or_fake_business_tables");
  assert.equal(await db.sql("SELECT run_id FROM synthetic_native_marker"), db.runId);
} catch (error) { if (stderr) process.stderr.write(stderr); failure = error; }
finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(worker); } catch (error) { cleanup.push(error); }
  for (const owned of [redis, db]) {
    if (!owned) continue;
    try { await owned.dispose(); assert.deepEqual(owned.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
    catch (error) { cleanup.push(error); }
  }
  if (cleanup.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanup], "construction_owned_cleanup_failed");
}
if (failure) throw failure;
console.log(JSON.stringify({ ...resultEvidence, disposablePostgres: true, disposableRedis: true, cleanupRemaining: 0,
  durationMs: Math.round(performance.now() - started) }));

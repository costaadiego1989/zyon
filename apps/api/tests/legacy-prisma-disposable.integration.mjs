import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { createDisposableRedis } from "./local-disposable-redis.mjs";
import { inspectNativePrismaClient, assertNativePrismaUrl } from "./native-prisma-admission-guards.mjs";
import { legacyPrismaSelection, legacyPrismaTestEnvironment } from "./legacy-prisma-disposable-guards.mjs";

const selection = legacyPrismaSelection(process.argv.slice(2));
const apiRoot = fileURLToPath(new URL("../", import.meta.url));
inspectNativePrismaClient(apiRoot);
const started = performance.now();
const db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker, closed, redis;
let output = "", errors = "", outputPrinted = false;
let primaryError;
try {
  assertNativePrismaUrl(db.prismaUrl);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  assert.match(db.runId, /^[a-f0-9-]{36}$/);
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  if (!selection.probeMissingFixture) await db.sql(await readFile(new URL(selection.fixture, import.meta.url), "utf8"));
  if (selection.name === "auth-me") redis = await createDisposableRedis();
  worker = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
    fileURLToPath(new URL("./legacy-prisma-disposable.worker.mjs", import.meta.url)), db.prismaUrl, db.runId, selection.name,
    ...(redis ? [redis.url, redis.runId] : [])],
  { cwd: apiRoot, env: legacyPrismaTestEnvironment(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let tooLarge = false;
  const collect = target => chunk => {
    if (output.length + errors.length + chunk.length > 2_000_000) { tooLarge = true; worker.kill(); return; }
    if (target === "out") output += chunk.toString(); else errors += chunk.toString();
  };
  worker.stdout.on("data", collect("out")); worker.stderr.on("data", collect("err"));
  closed = new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("close", (code, signal) => resolve({ code, signal }));
  });
  let timer;
  let result;
  try {
    result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("legacy_worker_deadline_exceeded")), 90_000); })]);
  } finally { clearTimeout(timer); }
  assert.equal(tooLarge, false, "legacy_worker_output_limit");
  // This worker has no provider credentials, accepts only verified synthetic URLs.
  process.stdout.write(output);
  outputPrinted = true;
  if (result.code !== 0) process.stderr.write(errors);
  assert.equal(result.code, 0, "legacy_prisma_test_failed");
  assert.equal(result.signal, null);
  assert.match(output, /^# pass [1-9]\d*$/m, "meaningful_tests_required");
  assert.match(output, /^# fail 0$/m);
  assert.match(output, /^# skipped 0$/m, "selected_legacy_test_must_execute");
  if (["checkout-repo", "checkout-controller", "payment"].includes(selection.name)) {
    assert.equal(await db.sql("SELECT (SELECT COUNT(*) FROM strategy_assignments)+(SELECT COUNT(*) FROM strategy_incentive_assignments)+(SELECT COUNT(*) FROM checkout_chat_requests)"), "0", "support_reader_projections_must_remain_empty");
    console.log(JSON.stringify({ supportReaderProjectionsRemainedEmpty: true }));
  }
} catch (error) {
  primaryError = error;
  if (!outputPrinted) { process.stdout.write(output); process.stderr.write(errors); }
}
finally {
  const cleanupErrors = [];
  try {
    if (worker && closed) {
      worker.kill();
      let timer;
      try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("owned_legacy_worker_cleanup_timeout")), 5_000); })]); }
      finally { clearTimeout(timer); }
    }
  } catch (error) { cleanupErrors.push(error); }
  try {
    if (redis) {
      await redis.dispose();
      assert.deepEqual(redis.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
    }
  } catch (error) { cleanupErrors.push(error); }
  try {
    await db.dispose();
    assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
  } catch (error) { cleanupErrors.push(error); }
  console.log(JSON.stringify({ suite: selection.name, status: primaryError || cleanupErrors.length ? "failed" : "passed", disposableDatabaseRemoved: cleanupErrors.length === 0,
    cleanupErrors: cleanupErrors.length, disposableRedisUsed: Boolean(redis), durationMs: Math.round(performance.now() - started), network: "none", productionAccess: false }));
  if (primaryError || cleanupErrors.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "legacy_disposable_validation_failed");
}

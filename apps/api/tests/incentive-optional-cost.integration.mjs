import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec"], "explicit_optional_cost_native_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url));
const normalize = value => value.replace(/\r\n/g, "\n").trim();
const historical = normalize(await readFile(new URL("../prisma/migrations/20260929100000_incentive_execution/migration.sql", import.meta.url), "utf8"));
const fixture = normalize(await readFile(new URL("./fixtures/incentive-optional-cost/synthetic.sql", import.meta.url), "utf8"));
const assignment = historical.slice(historical.indexOf("CREATE TABLE strategy_incentive_assignments ("), historical.indexOf("CREATE TABLE strategy_incentive_payment_evidence (" )).trim();
assert.ok(assignment.startsWith("CREATE TABLE strategy_incentive_assignments ("));
assert.equal(fixture.slice(fixture.indexOf("CREATE TABLE strategy_incentive_assignments (")).trim(), assignment, "fixture_assignment_ddl_must_equal_historical_11_field_table");
const guard = historical.slice(historical.indexOf("CREATE FUNCTION guard_incentive_assignment()"), historical.indexOf("CREATE FUNCTION guard_incentive_payment_evidence()" )).trim();
assert.ok(guard.startsWith("CREATE FUNCTION guard_incentive_assignment()"));
assert.ok(guard.endsWith("FOR EACH ROW EXECUTE FUNCTION guard_incentive_assignment();"));
const review = await readFile(new URL("../prisma/migrations/20261019100000_incentive_optional_cost/migration.sql", import.meta.url), "utf8");
const deploy = await readFile(new URL("../prisma/deploy-migrations/20261019100000_incentive_optional_cost/migration.sql", import.meta.url), "utf8");
assert.equal(review, deploy, "nullable_cost_tracks_must_be_byte_identical");
const safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, envFilesRead: false, assignmentFields: 11, historicalAssignmentAndGuard: true, migrationTracksByteIdentical: true }));
const started = performance.now(), db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker, closed, primary;
try {
  assertNativePrismaUrl(db.prismaUrl);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  assert.match(db.runId, /^[a-f0-9-]{36}$/);
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  await db.sql(fixture + "\n" + guard);
  worker = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    fileURLToPath(new URL("./incentive-optional-cost.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId],
    { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
  closed = new Promise((resolve, reject) => { worker.once("error", reject); worker.once("close", (code, signal) => resolve({ code, signal })); });
  let timer, result;
  try { result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native_optional_cost_worker_deadline_exceeded")), 60_000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(result.code, 0, "native_optional_cost_worker_failed");
  assert.equal(result.signal, null);
} catch (error) { primary = error; }
finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(worker); if (closed) await closed; } catch (error) { cleanup.push(error); }
  try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } catch (error) { cleanup.push(error); }
  console.log(JSON.stringify({ status: primary || cleanup.length ? "failed" : "passed", durationMs: Math.round(performance.now() - started),
    disposableDatabaseRemoved: cleanup.length === 0, cleanupErrors: cleanup.length, network: "none", productionAccess: false, fullLedgerProof: false }));
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], "native_optional_cost_validation_failed");
}

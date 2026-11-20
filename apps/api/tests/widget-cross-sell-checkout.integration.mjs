import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";
import { installCheckoutSessionVersionTrigger } from "./checkout-session-version-trigger.mjs";

assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec"].sort(), "explicit_widget_checkout_native_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url)), safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, nativeEngine: safety.nativeEngine, envFilesRead: false }));
const started = performance.now(), db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker, primary;
try {
  assertNativePrismaUrl(db.prismaUrl); assert.match(db.runId, /^[a-f0-9-]{36}$/);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  for (const fixture of ["legacy-prisma/checkout-payment.sql", "widget-cross-sell-checkout/synthetic.sql", "widget-cross-sell-checkout/payment.sql"])
    await db.sql(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  await installCheckoutSessionVersionTrigger(db);
  // The product fixture owns only checkout tables. Install the exact deployed
  // nullable origin expansion/guards, without claiming a full service migration.
  const serviceAuthorityName = "20261118020000_service_order_authority/migration.sql";
  const serviceAuthority = await readFile(new URL(`../prisma/deploy-migrations/${serviceAuthorityName}`, import.meta.url), "utf8");
  assert.equal(serviceAuthority, await readFile(new URL(`../prisma/migrations/${serviceAuthorityName}`, import.meta.url), "utf8"),
    "service_checkout_origin_deploy_migration_must_match");
  const originSchema = serviceAuthority.match(/ALTER TABLE checkout_sessions ADD COLUMN service_origin TEXT;[\s\S]*?FOR EACH ROW EXECUTE FUNCTION preserve_service_checkout_origin\(\);/);
  assert.ok(originSchema, "exact_service_checkout_origin_expansion_required");
  await db.sql(originSchema[0]);
  assert.equal(await db.sql(`SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='checkout_sessions'
      AND column_name IN ('service_origin','service_origin_proof') AND is_nullable='YES' AND column_default IS NULL`), "2",
    "actual_nullable_service_checkout_origin_columns_required");
  worker = spawn(process.execPath, ["--max-old-space-size=256", "--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
    fileURLToPath(new URL("./widget-cross-sell-checkout.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId],
  { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
  let deadline;
  const result = await new Promise((resolve, reject) => {
    // The combined corpus now also covers payment admission/order and provider
    // shipping transactions. Keep a bounded worker deadline and owned cleanup.
    deadline = setTimeout(() => reject(new Error("native_widget_checkout_deadline_exceeded")), 300_000);
    worker.once("error", reject); worker.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(deadline));
  assert.equal(result.code, 0, "native_widget_checkout_worker_failed"); assert.equal(result.signal, null);
} catch (error) { primary = error; }
finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(worker); } catch (error) { cleanup.push(error); }
  try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
  catch (error) { cleanup.push(error); }
  console.log(JSON.stringify({ status: primary || cleanup.length ? "failed" : "passed", cleanupErrors: cleanup.length,
    disposableDatabaseRemoved: cleanup.length === 0, bridgeClosed: cleanup.length === 0,
    durationMs: Math.round(performance.now() - started), network: "none", productionAccess: false }));
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], "native_widget_checkout_validation_failed");
}

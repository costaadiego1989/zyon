import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec"].sort(), "explicit_checkout_coupon_native_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url)), safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, nativeEngine: safety.nativeEngine, envFilesRead: false }));
const started = performance.now(), db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker, primary;
try {
  assertNativePrismaUrl(db.prismaUrl); assert.match(db.runId, /^[a-f0-9-]{36}$/);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  // Exact scalar tables from an existing owned fixture. No invented models,
  // altered Prisma client or runtime table/projection aliases.
  const legacy = await readFile(new URL("./fixtures/legacy-prisma/checkout-payment.sql", import.meta.url), "utf8");
  for (const table of ["checkout_sessions", "checkout_events", "completed_orders", "payment_intents"]) {
    const start = legacy.indexOf(`CREATE TABLE "${table}" (`), end = legacy.indexOf(";", start);
    assert.ok(start >= 0 && end > start, "exact_owned_checkout_table_required");
    const ddl = legacy.slice(start, end + 1);
    assert.ok(ddl.includes('"id" TEXT NOT NULL PRIMARY KEY')); assert.ok(!ddl.includes("FOREIGN KEY"));
    await db.sql(ddl);
  }
  for (const fixture of ["storefront-cart-unit-of-work/synthetic.sql", "storefront-local-cart-authority/synthetic.sql",
    "storefront-coupon-cross-sell/synthetic.sql"])
    await db.sql(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  worker = spawn(process.execPath, ["--max-old-space-size=256", "--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
    fileURLToPath(new URL("./storefront-checkout-coupon-application.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId],
  { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
  let timer;
  const result = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("native_checkout_coupon_deadline_exceeded")), 120_000);
    worker.once("error", reject); worker.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  assert.equal(result.code, 0, "native_checkout_coupon_worker_failed"); assert.equal(result.signal, null);
} catch (error) { primary = error; }
finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(worker); } catch (error) { cleanup.push(error); }
  try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
  catch (error) { cleanup.push(error); }
  console.log(JSON.stringify({ status: primary || cleanup.length ? "failed" : "passed", cleanupErrors: cleanup.length,
    disposableDatabaseRemoved: cleanup.length === 0, bridgeClosed: cleanup.length === 0,
    durationMs: Math.round(performance.now() - started), realProviderCalls: 0, publicEndpointProof: false, productionAccess: false }));
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], "native_checkout_coupon_validation_failed");
}

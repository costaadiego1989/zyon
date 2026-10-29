import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec"].sort(), "explicit_neighborhood_payment_native_flags_required");
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
  // Exact shipping-quote table definition; the same old migration also renames
  // unrelated production indexes not represented by this synthetic fixture.
  const shipping = await readFile(new URL("../prisma/migrations/20260619161050_add_shipping_quotes_table/migration.sql", import.meta.url), "utf8");
  const start = shipping.indexOf('CREATE TABLE "shipping_quotes" ('), end = shipping.indexOf(";", start);
  assert.ok(start >= 0 && end > start); const shippingTable = shipping.slice(start, end + 1);
  assert.ok(shippingTable.includes('CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")'));
  await db.sql(shippingTable);
  let settlement = await readFile(new URL("../prisma/migrations/20260910170000_payment_settlement_ledger/migration.sql", import.meta.url), "utf8");
  assert.ok(settlement.includes('CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"'));
  // Existing fixture already has this exact UNIQUE index. Retain all immutable
  // ledger constraints/triggers, as the existing native coupon parent does.
  settlement = settlement.replace('CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"', 'CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_id_merchant_id_key"');
  await db.sql(settlement);
  worker = spawn(process.execPath, ["--max-old-space-size=256", "--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
    fileURLToPath(new URL("./payment-neighborhood-admission.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId],
  { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
  let deadline;
  const result = await new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error("native_neighborhood_payment_deadline_exceeded")), 120_000);
    worker.once("error", reject); worker.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(deadline));
  assert.equal(result.code, 0, "native_neighborhood_payment_worker_failed"); assert.equal(result.signal, null);
} catch (error) { primary = error; }
finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(worker); } catch (error) { cleanup.push(error); }
  try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
  catch (error) { cleanup.push(error); }
  console.log(JSON.stringify({ status: primary || cleanup.length ? "failed" : "passed", cleanupErrors: cleanup.length,
    disposableDatabaseRemoved: cleanup.length === 0, bridgeClosed: cleanup.length === 0,
    durationMs: Math.round(performance.now() - started), network: "none", productionAccess: false }));
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], "native_neighborhood_payment_validation_failed");
}

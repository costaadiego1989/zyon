import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

const legacyReleaseOnly = process.argv.slice(2).includes("--legacy-release-only");
assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec", ...(legacyReleaseOnly ? ["--legacy-release-only"] : [])].sort(), "explicit_combined_coupon_native_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url)), safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, nativeEngine: safety.nativeEngine, envFilesRead: false }));
const started = performance.now(), db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker, primary;
try {
  assertNativePrismaUrl(db.prismaUrl); assert.match(db.runId, /^[a-f0-9-]{36}$/);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  if (legacyReleaseOnly) {
    // Exact scalar definitions from the existing owned fixture, not invented
    // checkout/payment projections. Common fixture's IF NOT EXISTS preserves it.
    const legacy = await readFile(new URL("./fixtures/legacy-prisma/checkout-payment.sql", import.meta.url), "utf8");
    for (const table of ["checkout_sessions", "payment_intents"]) {
      const start = legacy.indexOf(`CREATE TABLE "${table}" (`), end = legacy.indexOf(";", start);
      assert.ok(start >= 0 && end > start, "owned_legacy_table_definition_required");
      const ddl = legacy.slice(start, end + 1);
      assert.ok(ddl.includes('"id" TEXT NOT NULL PRIMARY KEY')); assert.ok(!ddl.includes("FOREIGN KEY"));
      await db.sql(ddl);
    }
  }
  for (const fixture of ["storefront-cart-unit-of-work/synthetic.sql", "storefront-local-cart-authority/synthetic.sql",
    "storefront-cross-sell-quote/synthetic.sql", "storefront-coupon-cross-sell/synthetic.sql", "storefront-combined-coupon/synthetic.sql"])
    await db.sql(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  const result = await new Promise((resolve, reject) => {
    worker = spawn(process.execPath, [...(legacyReleaseOnly ? ["--max-old-space-size=256"] : []), "--import", new URL("./test-network-guard.mjs", import.meta.url).href,
      "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
      fileURLToPath(new URL("./storefront-combined-coupon.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId,
      ...(legacyReleaseOnly ? ["--legacy-release-only"] : [])],
    { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
    const timer = setTimeout(() => reject(new Error("native_combined_coupon_worker_deadline_exceeded")), 180_000);
    worker.once("error", error => { clearTimeout(timer); reject(error); });
    worker.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.equal(result.code, 0, "native_combined_coupon_worker_failed"); assert.equal(result.signal, null);
} catch (error) { primary = error; }
finally {
  const cleanup = [];
  try { await terminateOwnedNativeWorker(worker); } catch (error) { cleanup.push(error); }
  try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } catch (error) { cleanup.push(error); }
  console.log(JSON.stringify({ status: primary || cleanup.length ? "failed" : "passed", durationMs: Math.round(performance.now() - started),
    disposableDatabaseRemoved: cleanup.length === 0, cleanupErrors: cleanup.length, bridgeClosed: cleanup.length === 0,
    network: "none", productionAccess: false, fullJourneyProof: false }));
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], "native_combined_coupon_validation_failed");
}

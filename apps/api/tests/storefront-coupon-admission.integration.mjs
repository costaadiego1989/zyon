import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

const legacyBasisOnly = process.argv.includes("--legacy-basis-only");
assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec",
  ...(legacyBasisOnly ? ["--legacy-basis-only"] : [])].sort(), "explicit_coupon_admission_native_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url)), safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, nativeEngine: safety.nativeEngine, envFilesRead: false }));
const started = performance.now(), db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker;
try {
  assertNativePrismaUrl(db.prismaUrl); assert.match(db.runId, /^[a-f0-9-]{36}$/);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  for (const path of ["./fixtures/legacy-prisma/checkout-payment.sql", "../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql",
    "./fixtures/storefront-bound-coupon-redemption/synthetic.sql", "../prisma/migrations/20260910170000_payment_settlement_ledger/migration.sql",
    "./fixtures/storefront-coupon-admission/synthetic.sql",
    ...(legacyBasisOnly ? ["./fixtures/storefront-coupon-source-basis/synthetic.sql"] : [])]) {
    let ddl = await readFile(new URL(path, import.meta.url), "utf8");
    if (path.endsWith("20260910170000_payment_settlement_ledger/migration.sql")) {
      // The legacy synthetic fixture already has UNIQUE(id,merchant_id), whose
      // automatic index has this exact name. Retain it and every ledger guard;
      // do not edit the real migration or disable an immutable-ledger trigger.
      assert.ok(ddl.includes('CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"'));
      ddl = ddl.replace('CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"',
        'CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_id_merchant_id_key"');
    }
    await db.sql(ddl);
  }
  const exit = await new Promise((resolve, reject) => {
    worker = spawn(process.execPath, [...(legacyBasisOnly ? ["--max-old-space-size=256"] : []), "--import", new URL("./test-network-guard.mjs", import.meta.url).href,
      "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
      fileURLToPath(new URL("./storefront-coupon-admission.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId,
      ...(legacyBasisOnly ? ["--legacy-basis-only"] : [])],
    { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
    const deadline = setTimeout(() => reject(new Error("native_coupon_admission_worker_deadline_exceeded")), 180_000);
    worker.once("error", error => { clearTimeout(deadline); reject(error); });
    worker.once("close", (code, signal) => { clearTimeout(deadline); resolve({ code, signal }); });
  });
  assert.equal(exit.code, 0, "native_coupon_admission_worker_failed"); assert.equal(exit.signal, null);
} finally {
  let workerError;
  try { await terminateOwnedNativeWorker(worker); } catch (error) { workerError = error; }
  await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
  console.log(JSON.stringify({ disposableDatabaseRemoved: true, bridgeClosed: true, execChildrenClosed: true,
    durationMs: Math.round(performance.now() - started), network: "none", productionAccess: false }));
  if (workerError) throw workerError;
}

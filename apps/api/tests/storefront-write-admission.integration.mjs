import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

assert.deepEqual(process.argv.slice(2).sort(), ["--local-disposable", "--prisma-loopback-exec"], "explicit_native_disposable_flags_required");
const apiRoot = fileURLToPath(new URL("../", import.meta.url));
const safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, nativeEngine: safety.nativeEngine, envFilesRead: false }));
const db = await createDisposablePostgres({ transport: "loopback-exec" });
let worker;
try {
  assertNativePrismaUrl(db.prismaUrl);
  assert.equal(await db.sql("SHOW listen_addresses"), "127.0.0.1");
  await db.sql("CREATE TABLE merchants (id TEXT PRIMARY KEY);");
  await db.sql(await readFile(new URL("./fixtures/storefront-write-ledger/candidate.sql", import.meta.url), "utf8"));
  assert.match(db.runId, /^[a-f0-9-]{36}$/);
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  const exit = await new Promise((resolve, reject) => {
    worker = spawn(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
      "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
      fileURLToPath(new URL("./storefront-write-admission.native-worker.mjs", import.meta.url)), db.prismaUrl, db.runId],
      { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ["ignore", "inherit", "inherit"] });
    const deadline = setTimeout(() => reject(new Error("native_prisma_worker_deadline_exceeded")), 180_000);
    worker.once("error", error => { clearTimeout(deadline); reject(error); });
    worker.once("close", (code, signal) => { clearTimeout(deadline); resolve({ code, signal }); });
  });
  assert.equal(exit.code, 0, "native_prisma_adapter_worker_failed");
  assert.equal(exit.signal, null);
} finally {
  let workerError;
  try { await terminateOwnedNativeWorker(worker); } catch (error) { workerError = error; }
  await db.dispose();
  assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
  if (workerError) throw workerError;
  console.log(JSON.stringify({ disposableDatabaseRemoved: true, bridgeClosed: true, execChildrenClosed: true, network: "none", productionAccess: false }));
}

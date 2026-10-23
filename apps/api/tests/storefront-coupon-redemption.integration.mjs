import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDisposablePostgres } from './local-disposable-postgres.mjs';
import { inspectNativePrismaClient, nativePrismaWorkerEnvironment, assertNativePrismaUrl } from './native-prisma-admission-guards.mjs';

assert.deepEqual(process.argv.slice(2).sort(), ['--local-disposable', '--prisma-loopback-exec'], 'explicit_redemption_native_flags_required');
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const safety = inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({ generatedEnvironmentChecked: safety.checkedCount, nativeEngine: safety.nativeEngine, envFilesRead: false }));
const started = performance.now(), db = await createDisposablePostgres({ transport: 'loopback-exec' });
let worker, closed, primary;
try {
  assertNativePrismaUrl(db.prismaUrl);
  assert.equal(await db.sql('SHOW listen_addresses'), '127.0.0.1');
  assert.match(db.runId, /^[a-f0-9-]{36}$/);
  await db.sql(`CREATE TABLE synthetic_native_marker (run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  await db.sql(await readFile(new URL('./fixtures/storefront-coupon-redemption/synthetic.sql', import.meta.url), 'utf8'));
  worker = spawn(process.execPath, ['--import', new URL('./test-network-guard.mjs', import.meta.url).href,
    '--loader', new URL('./ready-prod-loader.mjs', import.meta.url).href,
    fileURLToPath(new URL('./storefront-coupon-redemption.native-worker.mjs', import.meta.url)), db.prismaUrl, db.runId],
    { cwd: apiRoot, env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  closed = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', (code, signal) => resolve({ code, signal })); });
  let timer, result;
  try { result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('native_redemption_worker_deadline_exceeded')), 90_000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(result.code, 0, 'native_coupon_redemption_worker_failed'); assert.equal(result.signal, null);
} catch (error) { primary = error; }
finally {
  const cleanup = [];
  try {
    if (worker && closed) {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill();
      let timer;
      try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('owned_redemption_worker_cleanup_timeout')), 5000); })]); }
      finally { clearTimeout(timer); }
    }
  } catch (error) { cleanup.push(error); }
  try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
  catch (error) { cleanup.push(error); }
  console.log(JSON.stringify({ status: primary || cleanup.length ? 'failed' : 'passed', durationMs: Math.round(performance.now() - started),
    disposableDatabaseRemoved: cleanup.length === 0, cleanupErrors: cleanup.length, network: 'none', productionAccess: false }));
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup], 'native_coupon_redemption_validation_failed');
}

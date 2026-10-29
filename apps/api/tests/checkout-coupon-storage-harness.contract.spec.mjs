import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativePrismaWorkerEnvironment } from './native-prisma-admission-guards.mjs';

const guard = new URL('./test-network-guard.mjs', import.meta.url).href;
const execute = (filename, args) => spawnSync(process.execPath, ['--import', guard,
  fileURLToPath(new URL(filename, import.meta.url)), ...args], {
  env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, encoding: 'utf8', timeout: 5000,
});

for (const [name, args] of [
  ['implicit run', []],
  ['ambient database override', ['--local-disposable', '--prisma-loopback-exec', '--url=postgresql://external.invalid/production']],
  ['duplicate opt-in', ['--local-disposable', '--local-disposable', '--prisma-loopback-exec']],
]) test(`native binding_storage harness rejects ${name} before inspecting Prisma or creating Docker resources`, () => {
  const child = execute('./checkout-coupon-storage.integration.mjs', args);
  assert.equal(child.error, undefined); assert.equal(child.status, 1);
  assert.match(child.stderr, /explicit_binding_storage_native_flags_required/);
  assert.equal(child.stdout, '');
});

test('native binding_storage worker rejects foreign URLs before generated client import or DB access', () => {
  const child = execute('./checkout-coupon-storage.native-worker.mjs', ['postgresql://postgres@external.invalid/production',
    '12345678-1234-1234-1234-123456789abc']);
  assert.equal(child.error, undefined); assert.equal(child.status, 1);
  assert.equal(child.stdout, ''); assert.match(child.stderr, /AssertionError/);
  assert.equal(child.stderr.includes('PrismaClientInitializationError'), false);
});



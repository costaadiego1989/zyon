import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, localDatabaseTarget, persistenceRows } from './orders-shipments-qa-seed.mjs';

test('baseline covers all Kanban states and independent expected values', () => {
  const manifest = buildManifest();
  const actual = manifest.expectedByMerchant.qa_merchant_a;
  assert.equal(manifest.orders.length, 27);
  assert.equal(actual.totalOrders, 24);
  assert.equal(actual.realizedCount, 15);
  assert.equal(actual.revenueCents, 316609);
  assert.equal(actual.trackedCount, 8);
  assert.equal(actual.approvalRate, 0.625);
  assert.equal((actual.averageOrderCents / 100).toFixed(2), '211.07');
  assert.deepEqual(actual.byStatus, { pending: 2, processing: 2, approved: 5, paid: 4, shipped: 3, delivered: 3, cancelled: 2, failed: 1, refunded: 1, returned: 1 });
  assert.equal(actual.todayOrderKeys.includes('A17'), false);
  assert.equal(actual.todayOrderKeys.includes('A18'), true);
});

test('stable IDs, cross-tenant collision fixture and volume beyond UI cap', () => {
  assert.deepEqual(buildManifest(), buildManifest());
  const manifest = buildManifest({ volume: 1105 });
  assert.equal(manifest.expectedByMerchant.qa_merchant_a.totalOrders, 1105);
  assert.equal(manifest.expectedByMerchant.qa_merchant_a.revenueCents, 424709);
  assert.equal(new Set(manifest.orders.map(o => o.id)).size, 1108);
  const a = manifest.orders.find(o => o.scenarioKey === 'A03');
  const b = manifest.orders.find(o => o.scenarioKey === 'B01');
  assert.equal(a.externalOrderId, b.externalOrderId);
  assert.notEqual(a.merchantId, b.merchantId);
  assert.notEqual(a.id, b.id);
});

test('persistence graph preserves money units and tenant-qualified relationships', () => {
  const manifest = buildManifest();
  const data = persistenceRows(manifest);
  assert.equal(data.sessions.length, 27);
  assert.equal(data.shipments.length, 9);
  assert.equal(data.trackingEvents.length, 9);
  for (const order of manifest.orders) {
    const session = data.sessions.find(s => s.sessionId === order.sessionId && s.merchantId === order.merchantId);
    assert.ok(session);
    const row = data.orders.find(r => r.id === order.id);
    assert.equal(Math.round(Number(row.orderTotal) * 100), order.totalCents);
    assert.equal(row.lineItemsJson.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) + row.shippingCents, order.totalCents);
    assert.equal(data.payments.find(p => p.sessionId === order.sessionId).amountCents, order.totalCents);
    assert.equal(order.customer?.phone, undefined);
    if (order.customer) assert.match(order.customer.email, /@qa\.invalid$/);
    if (order.shipment) assert.equal(data.trackingEvents.find(e => e.shipmentId === order.shipment.id).merchantId, order.merchantId);
  }
});

test('invalid reference dates, merchant scope and volume fail before persistence', () => {
  for (const input of [{ asOfDate: '2026-02-30' }, { asOfDate: 'invalid' }, { volume: 23 }, { volume: 5001 }, { volume: NaN }, { merchantId: 'same', isolationMerchantId: 'same' }, { runId: '../oops' }]) assert.throws(() => buildManifest(input));
});

test('database target rejects production, missing worker stop and remote/overridden host', () => {
  const valid = { QA_ENV: 'local', QA_WORKERS_DISABLED: '1', QA_DATABASE_URL: 'postgresql://qa:placeholder@127.0.0.1:5432/zyon_qa', QA_EXPECT_DATABASE: 'zyon_qa' };
  assert.equal(localDatabaseTarget(valid).database, 'zyon_qa');
  for (const changes of [{ QA_ENV: 'production' }, { QA_WORKERS_DISABLED: '0' }, { QA_DATABASE_URL: undefined }, { QA_EXPECT_DATABASE: 'other' }, { QA_DATABASE_URL: 'postgresql://qa:placeholder@remote.invalid/zyon_qa' }, { QA_DATABASE_URL: 'postgresql://qa:placeholder@localhost/zyon_qa?host=remote.invalid' }, { QA_DATABASE_URL: 'mysql://localhost/zyon_qa' }]) assert.throws(() => localDatabaseTarget({ ...valid, ...changes }));
});

test('CLI defaults to dry-run even when regular DATABASE_URL points elsewhere', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./orders-shipments-qa-seed.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://unused@production.invalid/never-use' } });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.databaseConnected, false);
  assert.equal(output.manifest.orders.length, 27);
});

test('CLI cannot apply with implicit tenant/date or conflicting modes', () => {
  const script = fileURLToPath(new URL('./orders-shipments-qa-seed.mjs', import.meta.url));
  for (const args of [['--apply'], ['--apply', '--dry-run']]) {
    const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.equal(run.stdout, '');
  }
});

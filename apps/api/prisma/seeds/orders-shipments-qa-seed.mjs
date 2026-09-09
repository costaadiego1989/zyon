/** Local-only QA fixtures for reading orders/KPIs. Does not prove checkout side effects. */
import { createHash } from 'node:crypto';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'orders-shipments-qa-v1';
const DAY = 86_400_000;
export class SeedInputError extends Error {}
function check(condition, message) { if (!condition) throw new SeedInputError(message); }

// key, order state, total cents, days before local reference date, shipment state
const BASE = [
  ['A01', 'pending', 10000, 0], ['A02', 'processing', 20000, 0],
  ['A03', 'approved', 12000, 0], ['A04', 'paid', 24000, 0],
  ['A05', 'shipped', 30000, 1, 'in_transit'], ['A06', 'delivered', 18000, 2, 'delivered'],
  ['A07', 'cancelled', 9000, 0], ['A08', 'failed', 8000, 3],
  ['A09', 'refunded', 16000, 4, 'delivered'], ['A10', 'returned', 22000, 5, 'returned'],
  ['A11', 'approved', 15000, 6], ['A12', 'paid', 25000, 7],
  ['A13', 'shipped', 35000, 14, 'in_transit'], ['A14', 'delivered', 45000, 15, 'delivered'],
  ['A15', 'pending', 11000, 29], ['A16', 'cancelled', 13000, 30],
  ['A17', 'approved', 19999, 0], ['A18', 'paid', 20001, 0],
  ['A19', 'delivered', 0, 8, 'delivered'], ['A20', 'shipped', 9999, 31, 'in_transit'],
  ['A21', 'approved', 10500, 0], ['A22', 'paid', 8900, 0],
  ['A23', 'approved', 43210, 0], ['A24', 'processing', 5555, 0],
];

export function buildManifest({ runId = 'qa-orders-20260909', asOfDate = '2026-09-09', merchantId = 'qa_merchant_a', isolationMerchantId = 'qa_merchant_b', volume = 24 } = {}) {
  check(/^[a-z0-9][a-z0-9-]{2,49}$/.test(runId), 'run-id must contain 3-50 lowercase letters, digits or hyphens.');
  check(/^\d{4}-\d{2}-\d{2}$/.test(asOfDate), 'as-of must be YYYY-MM-DD.');
  const utcDate = new Date(`${asOfDate}T00:00:00.000Z`);
  check(Number.isFinite(utcDate.getTime()) && utcDate.toISOString().slice(0, 10) === asOfDate, 'as-of must be a valid calendar date.');
  check(utcDate.getUTCFullYear() >= 2020 && utcDate.getUTCFullYear() <= 2099, 'as-of must be between 2020 and 2099.');
  check(typeof merchantId === 'string' && merchantId.trim() === merchantId && merchantId.length > 0, 'merchant-id is required.');
  check(typeof isolationMerchantId === 'string' && isolationMerchantId.trim() === isolationMerchantId && isolationMerchantId.length > 0, 'isolation-merchant-id is required.');
  check(merchantId !== isolationMerchantId, 'The two merchants must be different.');
  check(Number.isInteger(volume) && volume >= 24 && volume <= 5000, 'volume must be an integer between 24 and 5000.');
  // Sao Paulo UTC-3 for the reference period; verify against Intl rather than assume silently.
  const midnight = Date.parse(`${asOfDate}T03:00:00.000Z`);
  const localHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(midnight);
  check(localHour === '00', 'Timezone rules changed; update the seed date conversion before use.');
  const definitions = BASE.map(row => [...row]);
  for (let i = 25; i <= volume; i++) definitions.push([`V${String(i).padStart(5, '0')}`, 'paid', 100, i % 40]);
  const makeOrder = (row, tenant) => {
    const [key, status, totalCents, daysAgo, shipmentStatus] = row;
    const token = createHash('sha256').update(`${VERSION}:${runId}:${tenant}:${key}`).digest('hex').slice(0, 24);
    const stem = `qaos_${token}`;
    let completedAt = new Date(midnight - daysAgo * DAY + 12 * 3_600_000).toISOString();
    if (key === 'A17') completedAt = new Date(midnight - 1).toISOString();
    if (key === 'A18') completedAt = new Date(midnight).toISOString();
    const customer = key === 'A21' ? null : {
      full_name: key === 'A24' ? '=1+1 QA "CSV"\nComprador' : `QA Comprador ${key}`,
      email: `${token}@qa.invalid`,
      ...(key === 'A22' ? {} : { address: { zip: '01001000', street: 'Endereco ficticio QA', number: '0', city: 'Sao Paulo', state: 'SP', neighborhood: 'Teste' } }),
    };
    const shippingCents = key === 'A23' ? 1500 : 0;
    const quantity = key === 'A23' ? 2 : 1;
    const unitPriceCents = (totalCents - shippingCents) / quantity;
    return {
      scenarioKey: key, merchantId: tenant, id: `${stem}_order`, sessionId: `${stem}_session`,
      sessionRecordId: `${stem}_session_row`, paymentId: `${stem}_payment`,
      // B01 deliberately shares A03's external ID; only the tenant disambiguates it.
      externalOrderId: `${runId}-${key === 'B01' ? 'A03' : key}`,
      status, currency: 'BRL', totalCents, shippingCents, completedAt, customer,
      paymentStatus: ['pending', 'processing', 'failed', 'cancelled', 'refunded'].includes(status) ? status : status === 'returned' ? 'refunded' : 'approved',
      paymentMethod: Number(key.replace(/\D/g, '')) % 2 ? 'pix' : 'credit_card',
      items: [{ sku: `${runId}-SKU-${key}`, name: `QA Produto ${key}`, quantity, unitPriceCents }],
      ...(shipmentStatus ? { shipment: { id: `${stem}_shipment`, eventId: `${stem}_tracking_event`, trackingCode: `QA${token.toUpperCase()}`, status: shipmentStatus } } : {}),
    };
  };
  const orders = definitions.map(row => makeOrder(row, merchantId));
  orders.push(...[['B01', 'paid', 990000, 0], ['B02', 'cancelled', 770000, 0], ['B03', 'delivered', 880000, 2, 'delivered']].map(row => makeOrder(row, isolationMerchantId)));
  const expectedByMerchant = {};
  for (const tenant of [merchantId, isolationMerchantId]) {
    const rows = orders.filter(o => o.merchantId === tenant);
    const realized = rows.filter(o => ['approved', 'paid', 'shipped', 'delivered'].includes(o.status));
    const revenueCents = realized.reduce((sum, o) => sum + o.totalCents, 0);
    expectedByMerchant[tenant] = {
      totalOrders: rows.length, realizedCount: realized.length, revenueCents,
      approvalRate: realized.length / rows.length, averageOrderCents: realized.length ? revenueCents / realized.length : 0,
      trackedCount: rows.filter(o => o.shipment).length,
      byStatus: Object.fromEntries([...new Set(rows.map(o => o.status))].map(state => [state, rows.filter(o => o.status === state).length])),
      todayOrderKeys: rows.filter(o => Date.parse(o.completedAt) >= midnight && Date.parse(o.completedAt) < midnight + DAY).map(o => o.scenarioKey),
    };
  }
  return { seedVersion: VERSION, runId, asOfDate, timezone: 'America/Sao_Paulo', volume, evidenceScope: 'Synthetic read-model data only; no checkout, provider, stock or notification effects executed.', orders, expectedByMerchant };
}

export function localDatabaseTarget(env) {
  check(env.QA_ENV === 'local', 'Database writes require QA_ENV=local; production/staging are not supported by this seed.');
  check(env.QA_WORKERS_DISABLED === '1', 'Stop local background workers, then set QA_WORKERS_DISABLED=1.');
  check(Boolean(env.QA_DATABASE_URL), 'QA_DATABASE_URL is required; DATABASE_URL and .env are deliberately not used.');
  let url;
  try { url = new URL(env.QA_DATABASE_URL); } catch { throw new SeedInputError('QA_DATABASE_URL must be a valid PostgreSQL URL.'); }
  check(['postgres:', 'postgresql:'].includes(url.protocol), 'Only PostgreSQL is supported.');
  check(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only a local PostgreSQL host is allowed.');
  check(!url.searchParams.has('host') && !url.searchParams.has('hostaddr') && !url.searchParams.has('service'), 'Connection target overrides are not allowed.');
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new SeedInputError('Invalid database name.'); }
  check(Boolean(database) && database === env.QA_EXPECT_DATABASE, 'QA_EXPECT_DATABASE must match the target database name exactly.');
  return { connectionString: env.QA_DATABASE_URL, host: url.hostname, database };
}

export function persistenceRows(manifest) {
  const sessions = [], orders = [], payments = [], shipments = [], trackingEvents = [];
  for (const order of manifest.orders) {
    const time = new Date(order.completedAt);
    const marker = { version: VERSION, runId: manifest.runId, asOfDate: manifest.asOfDate, scenarioKey: order.scenarioKey };
    sessions.push({
      id: order.sessionRecordId, merchantId: order.merchantId, sessionId: order.sessionId,
      globalUserId: `${order.sessionRecordId}_buyer`, conversationId: `${order.sessionRecordId}_conversation`,
      cart: { qa_seed: marker, currency: 'BRL', items: order.items.map(item => ({ sku: item.sku, name: item.name, quantity: item.quantity, unit_price: item.unitPriceCents })) },
      ...(order.customer ? { customer: order.customer } : {}),
      createdAt: time, updatedAt: time,
    });
    orders.push({
      id: order.id, merchantId: order.merchantId, sessionId: order.sessionId, externalOrderId: order.externalOrderId,
      orderTotal: (order.totalCents / 100).toFixed(2), currency: 'BRL', status: order.status,
      shippingCents: order.shippingCents, lineItemsJson: order.items,
      ...(order.shipment ? { trackingCode: order.shipment.trackingCode } : {}), completedAt: time,
      ...(order.status === 'cancelled' ? { cancelledAt: time, cancellationReason: 'QA cancelamento sintetico' } : {}),
    });
    payments.push({
      id: order.paymentId, merchantId: order.merchantId, sessionId: order.sessionId,
      idempotencyKey: `${order.paymentId}_key`, amountCents: order.totalCents, currency: 'BRL', method: order.paymentMethod,
      status: order.paymentStatus, ...(order.paymentStatus === 'approved' ? { approvedAmountCents: order.totalCents } : {}),
      creation: { qa_seed: marker, provider: 'qa_disabled' },
      statusHistory: [{ status: order.paymentStatus, occurred_at: order.completedAt }], createdAt: time, updatedAt: time,
    });
    if (order.shipment) {
      shipments.push({
        id: order.shipment.id, merchantId: order.merchantId, sessionId: order.sessionId, externalOrderId: order.externalOrderId,
        carrier: 'manual', trackingCode: order.shipment.trackingCode, status: order.shipment.status,
        createdAt: time, updatedAt: time, ...(order.shipment.status === 'delivered' ? { deliveredAt: time } : {}),
      });
      trackingEvents.push({
        id: order.shipment.eventId, merchantId: order.merchantId, shipmentId: order.shipment.id,
        trackingCode: order.shipment.trackingCode, status: order.shipment.status,
        description: 'QA snapshot sintetico; nao representa evento confirmado por transportadora.', carrierRaw: { qa_seed: marker }, occurredAt: time, createdAt: time,
      });
    }
  }
  return { sessions, orders, payments, shipments, trackingEvents };
}

export async function applySeed(manifest, env = process.env) {
  const target = localDatabaseTarget(env);
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('@prisma/client'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.connectionString, max: 2, connectionTimeoutMillis: 10000 }) });
  try {
    const rows = persistenceRows(manifest);
    const result = await prisma.$transaction(async tx => {
      const merchants = await tx.merchant.findMany({ where: { id: { in: Object.keys(manifest.expectedByMerchant) } }, select: { id: true, name: true } });
      check(merchants.length === 2 && merchants.every(m => /\b(qa|test|teste|homologacao)\b/i.test(m.name)), 'Both merchants must already exist and have a QA/test label in their name.');
      const groups = [['checkoutSession', rows.sessions], ['completedOrder', rows.orders], ['paymentIntent', rows.payments], ['shipment', rows.shipments], ['trackingEvent', rows.trackingEvents]];
      const counts = [];
      for (const [model, data] of groups) counts.push(await tx[model].count({ where: { id: { in: data.map(row => row.id) } } }));
      if (counts.some(Boolean)) {
        check(counts.every((count, index) => count === groups[index][1].length), 'Partial fixture run exists; use a new run-id. Existing records were not modified.');
        const existing = await tx.checkoutSession.findMany({ where: { id: { in: rows.sessions.map(row => row.id) } }, select: { id: true, merchantId: true, cart: true } });
        const expected = new Map(rows.sessions.map(row => [row.id, row]));
        check(existing.every(row => row.merchantId === expected.get(row.id)?.merchantId && row.cart?.qa_seed?.runId === manifest.runId && row.cart?.qa_seed?.version === VERSION), 'Fixture identity mismatch; no records changed.');
        check(existing.every(row => isDeepStrictEqual(row.cart, expected.get(row.id).cart)), 'Existing run uses a different cart/fixture definition; use a new run-id.');
        return { action: 'already_present_preserved', counts };
      }
      for (const [model, data] of groups) await tx[model].createMany({ data });
      return { action: 'created', counts: groups.map(([, data]) => data.length) };
    }, { isolationLevel: 'Serializable', timeout: 60000 });
    return { ...result, target: { host: target.host, database: target.database }, models: ['CheckoutSession', 'CompletedOrder', 'PaymentIntent', 'Shipment', 'TrackingEvent'], initialExpectedByMerchant: manifest.expectedByMerchant };
  } finally { await prisma.$disconnect(); }
}

async function main() {
  let values;
  try { ({ values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, 'run-id': { type: 'string' }, 'as-of': { type: 'string' }, 'merchant-id': { type: 'string' }, 'isolation-merchant-id': { type: 'string' }, volume: { type: 'string' } } })); }
  catch { throw new SeedInputError('Unknown or invalid argument; see docs/testing/dashboard-ready-prod/seeds.md.'); }
  check(!(values.apply && values['dry-run']), 'Choose --apply or --dry-run, not both.');
  if (values.apply) check(values['merchant-id'] && values['isolation-merchant-id'] && values['as-of'] && values['run-id'], '--apply requires explicit merchant IDs, --as-of and --run-id.');
  const manifest = buildManifest({ runId: values['run-id'], asOfDate: values['as-of'], merchantId: values['merchant-id'], isolationMerchantId: values['isolation-merchant-id'], volume: values.volume === undefined ? 24 : Number(values.volume) });
  const result = values.apply ? await applySeed(manifest) : { mode: 'dry-run', databaseConnected: false, manifest };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof SeedInputError ? error.message : 'Seed database operation failed; connection details are not logged. Check schema, local database and transaction state.'}\n`);
    process.exitCode = 1;
  });
}

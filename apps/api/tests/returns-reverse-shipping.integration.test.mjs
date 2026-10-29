import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ReturnReverseShippingService } from '../src/modules/returns/application/return-reverse-shipping.service.ts';
import { PrismaReturnRepository } from '../src/modules/returns/infrastructure/repositories/prisma-return.repository.ts';
import { CancelReturnUseCase } from '../src/modules/returns/application/use-cases/cancel-return.use-case.ts';

const url = process.env.READY_PROD_TEST_DATABASE_URL, target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/ready_prod_test') throw Error('disposable_database_required');
const { PrismaClient } = createRequire(import.meta.url)(process.env.READY_PROD_TEST_PRISMA_CLIENT);
const prisma = new PrismaClient({ datasources: { db: { url } } }), host = `reverse_${randomUUID()}`;
const parcel = { height: 12, width: 16, length: 24, weight: 2 }, repo = new PrismaReturnRepository(prisma);
before(async () => prisma.merchant.create({ data: { id: host, name: 'Reverse test shop' } }));
after(async () => {
  await prisma.return.deleteMany({ where: { merchantId: host } }); await prisma.trackingEvent.deleteMany({ where: { merchantId: host } });
  await prisma.shipment.deleteMany({ where: { merchantId: host } }); await prisma.completedOrder.deleteMany({ where: { merchantId: host } });
  await prisma.checkoutSession.deleteMany({ where: { merchantId: host } }); await prisma.merchant.delete({ where: { id: host } }); await prisma.$disconnect();
});
async function fixture(quantity = 1) {
  const sessionId = randomUUID(), orderId = randomUUID(), originalId = randomUUID();
  await prisma.checkoutSession.create({ data: { merchantId: host, sessionId, globalUserId: 'buyer', conversationId: sessionId, cart: {}, createdAt: new Date(), updatedAt: new Date() } });
  await prisma.completedOrder.create({ data: { merchantId: host, sessionId, externalOrderId: orderId, orderTotal: 30, currency: 'BRL',
    lineItemsJson: [{ variantId: 'v', name: 'Produto original', quantity: 3, unitPriceCents: 1000 }], completedAt: new Date() } });
  const returned = await repo.create({ merchantId: host, orderId, buyerId: 'buyer', reason: 'CHANGED_MIND', items: [{ variantId: 'v', quantity }] });
  const shipment = await prisma.shipment.create({ data: { id: randomUUID(), merchantId: host, sessionId, externalOrderId: orderId,
    carrier: 'melhor-envio', trackingCode: orderId, status: 'label_generated' } });
  await prisma.trackingEvent.create({ data: { id: `shipping_label_purchase_${randomUUID()}`, merchantId: host, shipmentId: shipment.id, trackingCode: orderId,
    status: 'label_generated', description: 'Native label receipt', occurredAt: new Date(), carrierRaw: { kind: 'zyon_native_label_purchase',
      external_order_id: orderId, carrier_order_id: originalId, account_identity: { version: 1, provider: 'melhor-envio', environment: 'test', originMerchantId: host, providerUserId: randomUUID() } } } });
  const counts = { carts: 0, checkouts: 0, generations: 0, reads: 0 }, native = { paid: false, code: null }, calls = [];
  let loseCheckout = false, loseGeneration = false, loseCartRead = false;
  const adapter = {
    original: async source => { assert.equal(source.originalOrderId, originalId); assert.equal(source.originMerchantId, host);
      calls.push(source); return { package: parcel, email: 'buyer@example.test', phone: '11999999999' }; },
    prepareRequest: async (source, input) => ({ ...source, body: { service: input.serviceId, package: input.package }, from: {}, to: {} }),
    create: async () => { counts.carts++; return randomUUID(); },
    read: async () => { counts.reads++; if (loseCartRead) throw Error('GET unavailable'); return { amountCents: 1999, paid: native.paid, code: native.code,
      generatedAt: native.code ? '2026-10-07 12:03:00' : null, purchasable: !native.paid }; },
    checkout: async () => {
      counts.checkouts++;
      const claim = await prisma.trackingEvent.findFirst({ where: { merchantId: host, status: 'reverse_purchase_unknown', carrierRaw: { path: ['returnId'], equals: returned.id } } });
      assert.ok(claim, 'claim must exist before debit'); assert.equal(claim.carrierRaw.amountCents, 1999);
      if (loseCheckout) throw Error('lost checkout'); native.paid = true;
    },
    generate: async () => { counts.generations++; if (loseGeneration) throw Error('lost generation'); native.code = '1234567890'; },
  };
  const service = new ReturnReverseShippingService(prisma, adapter);
  const input = { serviceId: 1, packages: [{ originMerchantId: host, package: parcel }] };
  return { returned, service, input, counts, native, calls, setLoseCheckout: () => { loseCheckout = true; },
    setLoseGeneration: () => { loseGeneration = true; }, setLoseCartRead: value => { loseCartRead = value; } };
}
test('concurrent preparations and confirmations produce one debit and one actual posting code', async () => {
  const f = await fixture(), candidates = await f.service.candidates(host, f.returned.id); assert.equal(candidates.candidates.length, 1);
  await Promise.all([f.service.prepare(host, f.returned.id, f.input), f.service.prepare(host, f.returned.id, f.input)]);
  assert.equal(f.counts.carts, 1); assert.equal(f.counts.checkouts, 0);
  const preview = await f.service.view(host, f.returned.id); assert.equal(preview.amountCents, 1999);
  await assert.rejects(f.service.confirm(host, f.returned.id, 2000), /cost_not_confirmed/); assert.equal(f.counts.checkouts, 0);
  await Promise.all([f.service.confirm(host, f.returned.id, 1999), f.service.confirm(host, f.returned.id, 1999)]);
  assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 1);
  const result = await repo.findById(host, f.returned.id); assert.equal(result.status, 'LABEL_GENERATED'); assert.equal(result.label.trackingNumber, '1234567890');
  assert.equal(result.label.expiresAt.toISOString(), '2026-10-14T00:00:00.000Z');
  await f.service.confirm(host, f.returned.id, 1999); assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 1);
});
test('partial return uses only returned products and uncertain checkout is observed without resubmission', async () => {
  const f = await fixture(1); await f.service.candidates(host, f.returned.id); assert.equal(f.calls[0].insuranceCents, 1000);
  await f.service.prepare(host, f.returned.id, f.input); f.setLoseCheckout();
  await f.service.confirm(host, f.returned.id, 1999); assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 0);
  await f.service.confirm(host, f.returned.id, 1999); assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 0);
  f.native.paid = true; await f.service.confirm(host, f.returned.id, 1999);
  assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 1); assert.equal((await repo.findById(host, f.returned.id)).status, 'LABEL_GENERATED');
});
test('uncertain generation is never repeated and the existing worker recovers native code by GET', async () => {
  const f = await fixture(); await f.service.prepare(host, f.returned.id, f.input); f.setLoseGeneration();
  await f.service.confirm(host, f.returned.id, 1999); await f.service.confirm(host, f.returned.id, 1999);
  assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 1); assert.equal((await repo.findById(host, f.returned.id)).label, undefined);
  f.native.code = '9876543210'; await prisma.trackingEvent.updateMany({ where: { merchantId: host, carrierRaw: { path: ['returnId'], equals: f.returned.id } }, data: { occurredAt: new Date(0) } });
  await f.service.reconcile(100); assert.equal(f.counts.checkouts, 1); assert.equal(f.counts.generations, 1);
  assert.equal((await repo.findById(host, f.returned.id)).label.trackingNumber, '9876543210');
});
test('merchant scope and manual registration cannot cross an automatic attempt; cancel before debit blocks purchase', async () => {
  const f = await fixture(); await assert.rejects(f.service.candidates('foreign', f.returned.id), /return_not_found/);
  await f.service.prepare(host, f.returned.id, f.input);
  await assert.rejects(repo.registerManualLabel(host, { returnId: f.returned.id, carrier: 'Correios', trackingNumber: '1234567890', expiresAt: new Date() }), /attempt_already_exists/);
  await new CancelReturnUseCase(repo, f.service).execute(host, f.returned.id);
  await assert.rejects(f.service.confirm(host, f.returned.id, 1999), /status_changed/); assert.equal(f.counts.checkouts, 0);
});
test('a persisted cart pointer survives a failed GET and is recovered without a second cart', async () => {
  const f = await fixture(); f.setLoseCartRead(true); await f.service.prepare(host, f.returned.id, f.input);
  assert.equal((await f.service.view(host, f.returned.id)).shipments[0].status, 'reverse_cart_unknown');
  f.setLoseCartRead(false); await prisma.trackingEvent.updateMany({ where: { merchantId: host, carrierRaw: { path: ['returnId'], equals: f.returned.id } }, data: { occurredAt: new Date(0) } });
  await f.service.reconcile(100); assert.equal((await f.service.view(host, f.returned.id)).shipments[0].status, 'reverse_cart_ready');
  assert.equal(f.counts.carts, 1); assert.equal(f.counts.checkouts, 0);
});

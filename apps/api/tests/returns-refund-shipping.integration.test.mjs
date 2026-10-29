import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaReturnRepository } from '../src/modules/returns/infrastructure/repositories/prisma-return.repository.ts';
import { PrismaPaymentRepository } from '../src/modules/payment/infrastructure/prisma-payment.repository.ts';
import { PrismaCheckoutRepository } from '../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts';
import { RefundPaymentService } from '../src/modules/payment/application/services/refund-payment.service.ts';
import { RequestReturnUseCase } from '../src/modules/returns/application/use-cases/request-return.use-case.ts';
import { ProcessRefundUseCase } from '../src/modules/returns/application/use-cases/process-refund.use-case.ts';
import { AcceptMarketplaceReturnUseCase } from '../src/modules/returns/application/use-cases/accept-marketplace-return.use-case.ts';
import { BuyerReturnsController } from '../src/modules/returns/presentation/http/buyer-returns.controller.ts';
import { ReturnShippingService } from '../src/modules/returns/application/return-shipping.service.ts';

const url = process.env.READY_PROD_TEST_DATABASE_URL, target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/ready_prod_test') throw Error('disposable_database_required');
const { PrismaClient } = createRequire(import.meta.url)(process.env.READY_PROD_TEST_PRISMA_CLIENT);
const prisma = new PrismaClient({ datasources: { db: { url } } });
const host = `refund_shipping_${randomUUID()}`, buyer = `${host}_buyer`;
const repo = new PrismaReturnRepository(prisma), payments = new PrismaPaymentRepository(prisma), orders = new PrismaCheckoutRepository(prisma);
before(async () => { await prisma.merchant.create({ data: { id: host, name: 'Refund shipping test' } }); });
after(async () => {
  await prisma.supportTicket.deleteMany({ where: { merchantId: host } });
  await prisma.return.deleteMany({ where: { merchantId: host } });
  await prisma.trackingEvent.deleteMany({ where: { merchantId: host } });
  await prisma.shipment.deleteMany({ where: { merchantId: host } });
  await prisma.paymentIntent.deleteMany({ where: { merchantId: host } });
  await prisma.completedOrder.deleteMany({ where: { merchantId: host } });
  await prisma.buyerPurchaseRecord.deleteMany({ where: { merchantId: host } });
  await prisma.checkoutSession.deleteMany({ where: { merchantId: host } });
  await prisma.merchant.delete({ where: { id: host } }); await prisma.$disconnect();
});
async function fixture(quantity = 1) {
  const sessionId = randomUUID(), orderId = `order_${sessionId}`, paymentId = `intent_${sessionId}`;
  const items = [{ sku: 'sku', variantId: 'v', quantity, unitPriceCents: 1000 }];
  const captured = 1000 * quantity + 1000;
  await prisma.checkoutSession.create({ data: { merchantId: host, sessionId, globalUserId: buyer, conversationId: sessionId,
    cart: { currency: 'BRL', items, total: captured / 100 }, createdAt: new Date(), updatedAt: new Date() } });
  const order = await prisma.completedOrder.create({ data: { merchantId: host, sessionId, externalOrderId: orderId,
    orderTotal: captured / 100, currency: 'BRL', shippingCents: 1000, lineItemsJson: items, completedAt: new Date() } });
  await prisma.paymentIntent.create({ data: { id: paymentId, merchantId: host, sessionId, idempotencyKey: sessionId,
    amountCents: captured, approvedAmountCents: captured, currency: 'BRL', method: 'pix', status: 'approved', providerPaymentId: `pay_${sessionId}`,
    creation: { state: 'complete', input: { merchantId: host, sessionId, intentId: paymentId, provider: 'asaas',
      providerAccountFingerprint: 'original-account', amountCents: captured, currency: 'BRL', method: 'pix' } } } });
  await prisma.buyerPurchaseRecord.create({ data: { merchantId: host, orderId, globalUserId: buyer, currency: 'BRL',
    totalAmount: captured / 100, discountAmount: 0, items, completedAt: new Date() } });
  return { order, orderId, paymentId, captured };
}
function request() {
  const createTicket = { execute: async input => prisma.supportTicket.create({ data: { id: randomUUID(), merchantId: input.merchantId,
    buyerMessage: input.message, source: input.source, returnId: input.returnId, status: 'open', createdAt: new Date(), updatedAt: new Date() } }) };
  const sendMessage = { execute: async input => prisma.supportTicketMessage.create({ data: { ticketId: input.ticketId,
    senderType: input.senderType, content: input.content, metadata: input.metadata } }) };
  return new RequestReturnUseCase(repo, createTicket, sendMessage);
}
test('buyer request creates one linked support ticket and approval refunds merchandise plus full original freight', async () => {
  const f = await fixture(), requests = [], labelCalls = [];
  const shipping = new ReturnShippingService(prisma, { cancelLabel: async input => {
    labelCalls.push(input); return { status: 'canceled', reason: 'carrier_wallet_refund_unproven', walletRefundStatus: 'unproven' }; } }, {});
  const shipment = await prisma.shipment.create({ data: { id: randomUUID(), merchantId: host, sessionId: f.order.sessionId, externalOrderId: f.orderId,
    carrier: 'melhor-envio', trackingCode: f.orderId, status: 'label_generated' } });
  await prisma.trackingEvent.create({ data: { id: `shipping_label_purchase_${randomUUID()}`, merchantId: host, shipmentId: shipment.id,
    trackingCode: f.orderId, status: 'label_generated', description: 'Original native label receipt', occurredAt: new Date(), carrierRaw: { kind: 'zyon_native_label_purchase',
      external_order_id: f.orderId, carrier_order_id: randomUUID(), account_identity: { version: 1, provider: 'melhor-envio',
        environment: 'test', originMerchantId: host, providerUserId: randomUUID() } } } });
  const service = new RefundPaymentService(payments, { refundPayment: async input => {
    const claim = await prisma.returnRefund.findUnique({ where: { returnId: returned.returnId } });
    assert.equal(claim.paymentIntentId, f.paymentId); assert.equal(claim.amountInCents, f.captured);
    assert.equal(claim.status, 'PENDING'); requests.push(input); return { refundId: 'native-refund', status: 'succeeded' }; } }, orders);
  const buyerController = new BuyerReturnsController(request(), {}, repo, {}, prisma);
  const returned = await buyerController.createReturnRequest({ user: { globalUserId: buyer } }, { merchantId: host,
    orderId: f.order.id, reason: 'CHANGED_MIND', items: [{ variantId: 'v', quantity: 1 }] });
  assert.equal(await prisma.supportTicket.count({ where: { merchantId: host, returnId: returned.returnId } }), 1);
  assert.ok(returned.ticketId);
  const process = new ProcessRefundUseCase(repo, service, undefined, shipping);
  const accept = new AcceptMarketplaceReturnUseCase(repo, undefined, undefined, process);
  const result = await accept.execute({ merchantId: host, returnId: returned.returnId });
  assert.equal(result.status, 'REFUND_COMPLETED'); assert.equal(result.refund.amountInCents, 2000);
  assert.equal(requests.length, 1); assert.equal(requests[0].providerAccountFingerprint, 'original-account');
  assert.equal(labelCalls.length, 1);
  const cancellation = await prisma.trackingEvent.findFirst({ where: { merchantId: host, id: { startsWith: 'return_label_cancel_' } } });
  assert.equal(cancellation.status, 'label_canceled'); assert.equal(cancellation.carrierRaw.wallet_refund_status, 'unproven');
  await process.execute(host, returned.returnId); assert.equal(requests.length, 1);
});
test('response loss preserves payment and proportional freight; reconciliation only reads and never cancels remaining goods', async () => {
  const f = await fixture(3); let posts = 0, gets = 0;
  const returned = await request().execute({ merchantId: host, orderId: f.orderId, buyerId: buyer, reason: 'DEFECTIVE', items: [{ variantId: 'v', quantity: 1 }] });
  const service = new RefundPaymentService(payments, { refundPayment: async () => { posts++; throw Error('response lost'); },
    fetchRefundStatus: async input => { gets++; assert.equal(input.providerAccountFingerprint, 'original-account'); return { state: 'succeeded' }; } }, orders);
  const shipping = new ReturnShippingService(prisma, { cancelLabel: async () => assert.fail('partial return cancels outbound goods') }, {});
  const process = new ProcessRefundUseCase(repo, service, undefined, shipping), accept = new AcceptMarketplaceReturnUseCase(repo, undefined, undefined, process);
  const pending = await accept.execute({ merchantId: host, returnId: returned.id });
  assert.equal(pending.status, 'REFUND_PROCESSING'); assert.equal(pending.refund.amountInCents, 1333); assert.equal(pending.refund.paymentIntentId, f.paymentId);
  assert.equal((await process.execute(host, returned.id)).status, 'REFUND_COMPLETED'); assert.equal(posts, 1); assert.equal(gets, 1);
});
test('a buyer cannot open a refund for another buyer\'s order', async () => {
  const f = await fixture(), controller = new BuyerReturnsController(request(), {}, repo, {}, prisma);
  await assert.rejects(controller.createReturnRequest({ user: { globalUserId: 'other-buyer' } }, {
    merchantId: host, orderId: f.orderId, reason: 'OTHER', items: [{ variantId: 'v', quantity: 1 }] }), /order_not_found/);
  assert.equal(await prisma.return.count({ where: { merchantId: host, orderId: f.orderId } }), 0);
});
test('concurrent refund requests for the same original order create one return and one ticket', async () => {
  const f = await fixture(), input = { merchantId: host, orderId: f.orderId, buyerId: buyer, reason: 'OTHER', items: [{ variantId: 'v', quantity: 1 }] };
  const results = await Promise.allSettled([request().execute(input), request().execute(input)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(await prisma.return.count({ where: { merchantId: host, orderId: f.orderId } }), 1);
});

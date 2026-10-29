import assert from "node:assert/strict";

/** Called ONLY by the existing guarded disposable worker, after its marker and
 * environment proof. Real Prisma/transactions; synthetic internal approval is
 * NOT a signed webhook, provider charge, HTTP journey or production proof. */
export async function runWidgetCheckoutPaymentNativeCases({ prisma, scope, adapter, resetManualShipping, request, contact, address, check, runId }) {
  assert.deepEqual(scope, { merchantId: "synthetic-merchant", sessionId: "synthetic-checkout" });
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  const { PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const { createWidgetCheckoutPaymentAdmission } = await import("../src/modules/payment/infrastructure/prisma-widget-checkout-payment-admission.ts");
  const { readAcceptedWidgetCheckoutInTransaction } = await import("../src/modules/cross-sell/infrastructure/repositories/widget-checkout-accepted-reader.ts");
  const { paymentCartFingerprint } = await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const { PrismaPaymentApprovalReader } = await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { CompleteOrderUseCase } = await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const paymentRepo = new PrismaPaymentRepository(prisma, undefined,
    createWidgetCheckoutPaymentAdmission(readAcceptedWidgetCheckoutInTransaction, () => 149));
  const checkout = new PrismaCheckoutRepository(prisma);
  const completion = new CompleteOrderUseCase(checkout, checkout, checkout, undefined, undefined, undefined, undefined, checkout,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(prisma));
  let sequence = 0;
  async function prepare() {
    await prisma.completedOrder.deleteMany({ where: scope });
    await resetManualShipping();
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope },
      data: { customer: { ...contact, email_verified: true, address, address_verified: true } } });
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
    await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } });
    await adapter.selectManualShipping(scope, { expectedVersion: 6, quoteId: row.shippingOptions.id, carrierKey: row.shippingOptions.options[0].carrier_key });
    const current = await prisma.$transaction(tx => readAcceptedWidgetCheckoutInTransaction(tx, scope));
    const fingerprint = paymentCartFingerprint({ cart: current.projectedCart, shipping: current.selectedShipping });
    const breakdown = { version: 1, currency: "BRL", cartFingerprint: fingerprint, itemsSubtotalCents: 11800,
      discountCents: 0, shippingCents: 900, platformFeeCents: 149, totalCents: 12849 };
    const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: `synthetic-payment-parity-${++sequence}`,
      amountCents: 12849, amountBreakdown: breakdown, currency: "BRL", method: "pix" });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 12849, currency: "BRL", method: "pix" });
    return { intent, breakdown };
  }
  const storedPayment = intent => prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
  async function approve(intent, provider = "synthetic-provider-parity") {
    intent.claimCreation("synthetic-first-send", new Date());
    await paymentRepo.saveIntent({ intent });
    intent.completeCreation("synthetic-first-send");
    intent.markApproved({ providerPaymentId: provider, approvedAmountCents: 12849 });
    await paymentRepo.saveIntent({ intent });
    return { merchant_id: scope.merchantId, session_id: scope.sessionId, external_order_id: provider, order_total: 127, currency: "BRL" };
  }
  const event = (intent, type) => ({ event_id: `synthetic-${intent.id}`, event_type: type, schema_version: 1, merchant_id: scope.merchantId,
    occurred_at: new Date().toISOString(), correlation_id: "synthetic", causation_id: intent.id, producer: "synthetic-native", payload: { payment_intent_id: intent.id } });
  const constraintFailure = expected => error => {
    assert.match(`${error?.message ?? ""} ${JSON.stringify(error?.meta ?? {})}`, expected,
      "rollback must reach the intended PostgreSQL constraint, not fail during admission/schema/fixtures");
    return true;
  };

  await check("actual repository captures immutable widget payment sibling atomically, never provider input", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent }); const row = await storedPayment(intent);
    assert.equal(row.version, 1); assert.equal(row.creation.widgetCheckoutAuthority.paymentId, intent.id);
    assert.equal(row.creation.widgetCheckoutAuthority.frozenProjection.cart.total, 118);
    assert.equal(row.creation.widgetCheckoutAuthority.amountBreakdown.discountCents, 0);
    assert.deepEqual(intent.snapshot().creation.widgetCheckoutAuthority, row.creation.widgetCheckoutAuthority);
    assert.equal("widgetCheckoutAuthority" in row.creation.input, false);
    await assert.rejects(checkout.getSession(scope.merchantId, scope.sessionId), /cross_sell_quote_review_required/);
  });
  await check("actual initial journal plus outbox rolls back together on database failure without caller ACK", async () => {
    const { intent } = await prepare(), before = await prisma.outboxMessage.count();
    await assert.rejects(paymentRepo.saveIntentWithOutbox({ intent }, event(intent, "synthetic.payment.rollback")),
      constraintFailure(/synthetic_widget_payment_rollback/));
    assert.equal(await prisma.paymentIntent.count({ where: scope }), 0); assert.equal(await prisma.outboxMessage.count(), before);
    assert.equal(intent.snapshot().version, 0); assert.equal(intent.snapshot().creation.widgetCheckoutAuthority, undefined);
  });
  await check("actual first-send rejects changed catalog without persisting a lease or replacing admitted price", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent }); const before = await storedPayment(intent);
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=2001 WHERE variant_id='target'`;
    intent.claimCreation("synthetic-stale-send", new Date()); await assert.rejects(paymentRepo.saveIntent({ intent }));
    assert.deepEqual(await storedPayment(intent), before);
  });
  await check("actual uncertain recovery keeps original payment identity despite later catalog mutation", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent });
    intent.claimCreation("synthetic-attempt", new Date()); await paymentRepo.saveIntent({ intent });
    intent.markCreationUncertain("synthetic-attempt", "synthetic-ack-unknown"); await paymentRepo.saveIntent({ intent });
    const before = (await storedPayment(intent)).creation.widgetCheckoutAuthority;
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id='target'`;
    intent.claimCreation("synthetic-recovery", new Date(Date.now() + 120000)); await paymentRepo.saveIntent({ intent });
    assert.deepEqual((await storedPayment(intent)).creation.widgetCheckoutAuthority, before);
  });
  await check("actual paid order freezes P+D, contacts and fee exclusion after checkout/catalog mutation; retry exactly once", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent }); const input = await approve(intent);
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id='target'`;
    await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{email}','"changed@example.test"'::jsonb),
      shipping_options=NULL,strategy_context_version=strategy_context_version+1,version=version+1`;
    assert.equal((await completion.executePaymentApproval(input, intent.id)).idempotent, false);
    const orders = await prisma.completedOrder.findMany({ where: scope }); assert.equal(orders.length, 1);
    assert.equal(Number(orders[0].orderTotal), 127); assert.equal(orders[0].shippingCents, 900);
    // The accepted quote sorts canonical identities. The order must preserve
    // that admitted order and exact money, not the initial fixture read order.
    const admitted = (await storedPayment(intent)).creation.widgetCheckoutAuthority.frozenProjection.cart.items;
    assert.deepEqual(orders[0].lineItemsJson.map(line => [line.sku, line.unitPriceCents, line.quantity]),
      admitted.map(line => [line.sku, Math.round(line.price * 100), line.quantity]));
    assert.deepEqual(orders[0].lineItemsJson.map(line => [line.sku, line.unitPriceCents]), [["TARGET", 1800], ["TRIGGER", 10000]]);
    assert.equal(orders[0].fulfillmentJson.units.length, 2);
    const confirmations = await prisma.outboxMessage.findMany({ where: { merchantId: scope.merchantId, eventType: "order.confirmed" } });
    assert.equal(confirmations.length, 1); assert.equal(confirmations[0].payload.buyerEmail, contact.email);
    const before = await prisma.outboxMessage.count();
    assert.equal((await completion.executePaymentApproval(input, intent.id)).idempotent, true);
    assert.equal(await prisma.outboxMessage.count(), before);
    assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "order_completed" } }), 1);
  });
  await check("actual concurrent approved completions commit one order and one confirmation", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent }); const input = await approve(intent);
    const results = await Promise.all([completion.executePaymentApproval(input, intent.id), completion.executePaymentApproval(input, intent.id)]);
    assert.deepEqual(results.map(result => result.idempotent).sort(), [false, true]);
    assert.equal(await prisma.completedOrder.count({ where: scope }), 1);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId: scope.merchantId, eventType: "order.completed" } }), 1);
  });
  await check("actual refunded journal cannot authorize new frozen order or confirmation", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent }); const input = await approve(intent);
    await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "refunded" } }); const before = await prisma.outboxMessage.count();
    await assert.rejects(completion.executePaymentApproval(input, intent.id));
    assert.equal(await prisma.completedOrder.count({ where: scope }), 0); assert.equal(await prisma.outboxMessage.count(), before);
  });
  await check("actual order/fulfillment/event/outbox rollback together when final confirmation insert fails", async () => {
    const { intent } = await prepare(); await paymentRepo.saveIntent({ intent }); const input = await approve(intent, "synthetic-provider-rollback");
    const before = await prisma.outboxMessage.count(); await assert.rejects(completion.executePaymentApproval(input, intent.id),
      constraintFailure(/synthetic_widget_order_rollback/));
    assert.equal(await prisma.completedOrder.count({ where: scope }), 0);
    assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "order_completed" } }), 0);
    assert.equal(await prisma.outboxMessage.count(), before); assert.equal((await storedPayment(intent)).status, "approved");
  });
}

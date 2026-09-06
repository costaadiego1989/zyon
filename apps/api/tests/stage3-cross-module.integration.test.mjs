import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts";
import { PrismaPaymentApprovalReader } from "../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.ts";
import { checkoutSession } from "../src/modules/checkout/__tests__/checkout-test-fixtures.ts";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.ts";
import { InventoryOnOrderCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-order-completed.handler.ts";
import { OnSaleCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-sale-completed.handler.ts";
import { HandleSaleCompletedUseCase } from "../src/modules/inventory/application/use-cases/handle-sale-completed.use-case.ts";
import { PrismaInventorySaleRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-inventory-sale.repository.ts";
import { PrismaStrategyLessonRepository } from "../src/modules/revenue-manager/infrastructure/prisma-strategy-lesson.repository.ts";
import { StrategyLessonEntity } from "../src/modules/revenue-manager/domain/entities/strategy-lesson.entity.ts";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.ts";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
function client() {
  const target = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.pathname === "/ready_prod_test");
  const { PrismaClient } = createRequire(import.meta.url)(clientPath);
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 30000, timeout: 15000 } });
}

test("PostgreSQL: concurrent paid completions persist one order/event; replay debits immutable inventory once", { skip: !databaseUrl || !clientPath }, async () => {
  const prisma = client(), replica = client();
  const merchantId = `cross_stage3_${randomUUID()}`, sessionId = randomUUID(), paymentId = randomUUID(), orderId = randomUUID();
  try {
    await prisma.merchant.create({ data: { id: merchantId, name: "Disposable cross-module test" } });
    const sessions = new PrismaCheckoutRepository(prisma), otherSessions = new PrismaCheckoutRepository(replica);
    await sessions.saveSession(checkoutSession({ merchantId, sessionId }));
    const breakdown = { version: 1, currency: "BRL", itemsSubtotalCents: 30000, discountCents: 0,
      shippingCents: 3500, platformFeeCents: 1500, totalCents: 35000,
      cartFingerprint: paymentCartFingerprint(checkoutSession({ merchantId, sessionId })) };
    await prisma.paymentIntent.create({ data: { id: paymentId, merchantId, sessionId, idempotencyKey: randomUUID(),
      amountCents: 35000, approvedAmountCents: 35000, currency: "BRL", method: "card", status: "approved",
      providerPaymentId: orderId, amountBreakdown: breakdown } });
    function useCase(repository, db) {
      return new CompleteOrderUseCase(repository, repository, repository, repository,
        undefined, undefined, undefined, repository, undefined, undefined, undefined, undefined, undefined,
        new PrismaPaymentApprovalReader(db));
    }
    const first = useCase(sessions, prisma), second = useCase(otherSessions, replica);
    const request = { merchant_id: merchantId, session_id: sessionId, external_order_id: orderId, order_total: 350, currency: "BRL" };
    const failingTransaction = { transaction: work => sessions.transaction(tx => work({
      saveCompletedOrder: order => tx.saveCompletedOrder(order),
      recordEvent: (...args) => tx.recordEvent(...args),
      appendOutbox: async () => { throw new Error("injected_outbox_failure"); },
    })) };
    const failingCompletion = new CompleteOrderUseCase(sessions, sessions, sessions, sessions,
      undefined, undefined, undefined, failingTransaction, undefined, undefined, undefined, undefined, undefined,
      new PrismaPaymentApprovalReader(prisma));
    await assert.rejects(failingCompletion.executePaymentApproval(request, paymentId), /injected_outbox_failure/);
    assert.equal(await prisma.completedOrder.count({ where: { merchantId } }), 0);
    assert.equal(await prisma.checkoutEvent.count({ where: { merchantId } }), 0);
    const completions = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).executePaymentApproval(request, paymentId)));
    assert.equal(completions.filter(result => !result.idempotent).length, 1);
    assert.equal(await prisma.completedOrder.count({ where: { merchantId } }), 1);
    const events = await prisma.outboxMessage.findMany({ where: { merchantId, eventType: "order.completed" } });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload.payment_amount_breakdown, breakdown);
    const reader = new PrismaPaymentApprovalReader(prisma);
    assert.equal(await reader.find("other", sessionId, paymentId), null);
    assert.equal(await reader.find(merchantId, "other", paymentId), null);
    const location = await prisma.inventoryLocation.create({ data: { merchantId, name: "Default", isDefault: true, isActive: true } });
    const item = await prisma.inventoryItem.create({ data: { merchantId, sku: "kit", productName: "Kit", locationId: location.id, quantity: 10, reserved: 0 } });
    await sessions.saveSession(checkoutSession({ merchantId, sessionId, cart: { currency: "BRL", total: 0, items: [] } }));
    assert.equal((await first.executePaymentApproval(request, paymentId)).idempotent, true);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId, eventType: "order.completed" } }), 1);
    const bus = new InMemoryDomainEventBus();
    new InventoryOnOrderCompletedHandler(bus, new HandleSaleCompletedUseCase(new OnSaleCompletedHandler(new PrismaInventorySaleRepository(prisma))), sessions).onModuleInit();
    const event = { eventId: events[0].eventId, eventType: "order.completed", merchantId, payload: events[0].payload };
    await Promise.all(Array.from({ length: 20 }, () => bus.publish(event)));
    assert.equal((await prisma.inventoryItem.findUnique({ where: { id: item.id } })).quantity, 9);
    assert.equal(await prisma.inventoryMovement.count({ where: { merchantId } }), 1);
    assert.equal(await prisma.inventorySaleReceipt.count({ where: { merchantId } }), 1);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId, producer: "inventory" } }), 3);
    const receipt = await prisma.inventorySaleReceipt.findFirst({ where: { merchantId } });
    assert.equal(receipt.payload.totalCents, 35000);
  } finally {
    await prisma.outboxMessage.deleteMany({ where: { merchantId } });
    await prisma.inventorySaleReceipt.deleteMany({ where: { merchantId } });
    await prisma.inventoryItem.deleteMany({ where: { merchantId } });
    await prisma.inventoryLocation.deleteMany({ where: { merchantId } });
    await prisma.paymentIntent.deleteMany({ where: { merchantId } });
    await prisma.checkoutSession.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.$disconnect(); await replica.$disconnect();
  }
});

test("PostgreSQL: strategy lesson replays across replicas preserve one effect and reject cross-tenant linkage", { skip: !databaseUrl || !clientPath }, async () => {
  const prisma = client(), replica = client(), merchantId = `lesson_stage3_${randomUUID()}`;
  let observationId;
  try {
    const observation = await prisma.revenueManagerObservation.create({ data: { merchantId, observationWindowStart: new Date(),
      observationWindowEnd: new Date(), funnelJson: {}, abandonmentJson: {}, objectionsJson: {}, crossSellJson: {},
      cohortsJson: {}, revenueJson: {}, aiCostsCents: 0, fingerprint: randomUUID() } });
    observationId = observation.id;
    const experimentId = randomUUID();
    const hypothesis = await prisma.revenueManagerHypothesis.create({ data: { merchantId, observationId,
      hypothesisText: "Fixture", reasoning: "Fixture", expectedLiftPercent: 1, riskLevel: "low", templateJson: {},
      approvalStrategy: "manual", createdExperimentId: experimentId } });
    const data = { merchant_id: merchantId, experiment_id: experimentId, hypothesis_id: hypothesis.id,
      hypothesis_text: "Fixture", actual_winner: "control", hypothesis_was_correct: false, control_conversion_rate: .2,
      challenger_conversion_rate: .1, conversion_lift_percent: -50, sessions_per_variant: 100, statistical_confidence: .95,
      insights: { why_winner_won: "Fixture", objection_reduction: "Fixture", decision_speed_impact: "Fixture",
        cross_sell_impact: "Fixture", recommended_next_steps: [] }, generator_feedback: "Fixture" };
    const first = new PrismaStrategyLessonRepository(prisma), second = new PrismaStrategyLessonRepository(replica);
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).save(StrategyLessonEntity.create(data))));
    assert.equal(new Set(outcomes.map(lesson => lesson.id)).size, 1);
    assert.equal(await prisma.revenueManagerStrategyLesson.count({ where: { merchantId } }), 1);
    await assert.rejects(first.save(StrategyLessonEntity.create({ ...data, merchant_id: "other" })), /hypothesis_experiment_mismatch/);
    await assert.rejects(first.save(StrategyLessonEntity.create({ ...data, experiment_id: "other" })), /hypothesis_experiment_mismatch/);
  } finally {
    if (observationId) await prisma.revenueManagerObservation.delete({ where: { id: observationId } });
    await prisma.$disconnect(); await replica.$disconnect();
  }
});

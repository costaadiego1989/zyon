import assert from "node:assert/strict";
import test from "node:test";
import { Redis } from "ioredis";
import type { CheckoutSession } from "@zyon/shared-types";
import type { DomainEventBus, DomainEvent } from "../src/shared/events/domain-event-bus.port.js";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.js";
import { PaymentApprovedHandler } from "../src/modules/checkout/application/handlers/payment-approved.handler.js";
import { PAYMENT_APPROVED_EVENT } from "../src/modules/checkout/domain/events/payment-approved.event.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentApprovalReader } from "../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { serviceCheckoutProvenance } from "../src/shared/bookings/service-checkout-provenance.js";
import { professionalSlotId, professionalHoldRequests } from "../src/shared/bookings/service-checkout-selection.js";
import { RedisServiceSlots, closeServiceSlotStore } from "../src/shared/bookings/redis-service-slots.js";
import { readFulfillment } from "../src/modules/operations/domain/order-fulfillment.js";
import { InventoryOnOrderCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-order-completed.handler.js";
import { OnSaleCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-sale-completed.handler.js";
import { HandleSaleCompletedUseCase } from "../src/modules/inventory/application/use-cases/handle-sale-completed.use-case.js";
import { MarketplaceStockPushService } from "../src/modules/inventory/application/services/marketplace-stock-push.service.js";
import { PrismaInventorySaleRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-inventory-sale.repository.js";
import { PrismaInventoryRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-inventory.repository.js";
import { PrismaErpRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-erp.repository.js";

// Actual persisted-approval handler -> completion -> Prisma transaction ->
// canonical appointments. Payment evidence is local synthetic SQL, no PSP call.
test("T35 persisted approval completes every frozen professional unit", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" }), previousRedis = process.env.REDIS_URL;
  let redis: Redis | undefined;
  try {
    process.env.REDIS_URL = f.runtime.redis.url;
    redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId);
    const store = new RedisServiceSlots(redis), repository = new PrismaCheckoutRepository(f.prisma);
    const complete = new CompleteOrderUseCase(repository, repository, repository, undefined, undefined, undefined, undefined, repository,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(f.prisma));
    let deliver: ((event: DomainEvent) => Promise<void>) | undefined;
    const bus: DomainEventBus = { subscribe: (name, callback) => { assert.equal(name, PAYMENT_APPROVED_EVENT); deliver = callback; },
      handlersFor: () => [], publish: async () => assert.fail("unexpected external event dispatch") };
    new PaymentApprovedHandler(bus, complete).onModuleInit(); assert.ok(deliver);
    let stockProviderCalls = 0;
    const push = new MarketplaceStockPushService(new PrismaErpRepository(f.prisma), new PrismaInventoryRepository(f.prisma), {
      getValidAccessToken: async () => { stockProviderCalls++; throw new Error("unexpected_external_stock_provider"); },
    });
    const inventory = new InventoryOnOrderCompletedHandler(bus,
      new HandleSaleCompletedUseCase(new OnSaleCompletedHandler(new PrismaInventorySaleRepository(f.prisma)), push), repository);
    const prepare = async (suffix: string, held = true) => {
      const sources = [await f.prepare("complete-a-" + suffix, "online"), await f.prepare("complete-b-" + suffix, "online")];
      // Explicit historical UTC professional facts precede every frozen paid selector and original lease.
      for (const source of sources) source.professional = await f.prisma.serviceProfessional.update({ where: { id: source.professional.id }, data: { timeZone: "UTC" } });
      const merchantId = f.owner.merchant_id, policy = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId } });
      const configured = await f.request("/merchants/me/service-business-policy", { expectedVersion: policy.version, paymentMode: "online",
        holdEnabled: true, holdMinutes: 7, admissionsEnabled: true }, f.owner, "PUT"); assert.equal(configured.status, 200);
      const selections = sources.map(c => { const s = { productId: c.product.id, variantId: c.product.variants[0].id, professionalId: c.professional.id,
        professionalVersion: c.professional.version, policyVersion: configured.body.version, date: c.date,
        startsAt: c.date + "T10:20:00.000Z", endsAt: c.date + "T10:40:00.000Z", timeZone: "UTC", durationMinutes: 20,
        priceInCents: 5000, currency: "BRL", slotId: "" }; s.slotId = professionalSlotId(merchantId, s); return s; });
      const sessionId = "complete-service-" + suffix, providerId = "synthetic-approved-" + suffix;
      const cart: CheckoutSession["cart"] = { currency: "BRL", total: 100, currentDiscount: 0,
        items: selections.map((s, index) => ({ sku: sources[index].product.variants[0].sku, product_id: s.productId,
          variantId: s.variantId, name: "Synthetic frozen unit", productType: "service", fulfillmentStrategy: "scheduled_service",
          quantity: 1, price: 50, fulfillmentSchedule: s })) };
      const scope = { merchantId, sessionId, globalUserId: "complete-buyer-" + suffix }, now = new Date();
      await f.prisma.checkoutSession.create({ data: { ...scope, ...serviceCheckoutProvenance(scope, { serverChannel: "storefront" }),
        conversationId: sessionId, cart: JSON.parse(JSON.stringify(cart)), customer: { fullName: "Synthetic paid buyer", email: "paid@example.test" }, createdAt: now, updatedAt: now } });
      if (held) await store.acquire(merchantId, sessionId, professionalHoldRequests(selections), 420_000);
      const money = await f.prisma.paymentIntent.create({ data: { id: "complete-intent-" + suffix, merchantId, sessionId, idempotencyKey: sessionId,
        amountCents: 10000, approvedAmountCents: 10000, currency: "BRL", method: "pix", status: "approved", providerPaymentId: providerId,
        amountBreakdown: { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint({ cart }), itemsSubtotalCents: 10000,
          discountCents: 0, shippingCents: 0, platformFeeCents: 0, totalCents: 10000 } } });
      const event = { eventId: "payment-event-" + suffix, eventType: PAYMENT_APPROVED_EVENT, merchantId, payload: {
        sessionId, externalOrderId: providerId, orderTotalMajorUnits: 100, currency: "BRL", paymentIntentId: money.id } };
      return { merchantId, sessionId, selections, money, event, providerId };
    };
    const orderFor = (c: Awaited<ReturnType<typeof prepare>>) => f.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: c.merchantId, sessionId: c.sessionId } });
    let accepted: Awaited<ReturnType<typeof prepare>>;

    await t.test("real approval handler confirms both units under one original generation and full resource fingerprint", async () => {
      const c = accepted = await prepare("all-units"); await deliver!(c.event);
      const order = await orderFor(c), appointments = await f.prisma.serviceAppointment.findMany({ where: { orderId: order.id }, orderBy: { orderUnitId: "asc" } });
      assert.equal(appointments.length, 2); assert.deepEqual(appointments.map(a => a.orderUnitId), ["line_1", "line_2"]);
      assert.ok(appointments.every(a => a.operationalStatus === "scheduled" && a.origin === "storefront"));
      const captures = await f.prisma.appointmentAudit.findMany({ where: { appointmentId: { in: appointments.map(a => a.id) }, action: "admit" } });
      assert.equal(captures.length, 2); const proofs = captures.map(a => (a.after as any).privateLease);
      assert.equal(proofs[0].generation, proofs[1].generation); assert.equal(proofs[0].fingerprint, proofs[1].fingerprint);
      for (const proof of proofs) assert.deepEqual(proof.resources, c.selections.map(s => "professional:" + s.professionalId).sort());
      assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.money.id, status: "approved" } }), 2);
      assert.equal(await f.prisma.serviceReservation.count({ where: { orderId: order.id, classificationPending: false } }), 2);
      const completed = await f.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: c.merchantId, eventType: "order.completed", causationId: c.providerId } });
      const event = { eventId: completed.eventId, eventType: completed.eventType, merchantId: completed.merchantId, payload: completed.payload };
      assert.deepEqual((completed.payload as any).inventory_sale.items, []);
      await inventory.handle(event); await inventory.handle(event);
      assert.equal(await f.prisma.inventoryMovement.count(), 0); assert.equal(await f.prisma.outboxMessage.count({ where: { producer: "inventory" } }), 0);
      assert.equal(await f.prisma.inventorySaleReceipt.count({ where: { merchantId: c.merchantId } }), 0); assert.equal(stockProviderCalls, 0);
    });
    await t.test("duplicate approval after mutable cart change retains immutable order units money and event receipts", async () => {
      const c = accepted!, order = await orderFor(c), appointments = await f.prisma.serviceAppointment.findMany({ where: { orderId: order.id }, orderBy: { id: "asc" } });
      const before = await Promise.all(appointments.map(a => f.snapshot(a.id)));
      await f.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } }, data: { cart: { items: [], total: 0, currency: "BRL" } } });
      await Promise.all([deliver!(c.event), deliver!(c.event)]);
      assert.deepEqual(await Promise.all(appointments.map(a => f.snapshot(a.id))), before); assert.deepEqual(await orderFor(c), order);
      assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: c.merchantId, eventType: "order.completed", causationId: c.providerId } }), 1);
      assert.equal(await f.prisma.paymentIntent.count({ where: { id: c.money.id } }), 1);
    });
    await t.test("approved evidence without the full original lease never creates an appointment or another charge", async () => {
      const c = await prepare("missing-hold", false), before = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.money.id } });
      await deliver!(c.event); const order = await orderFor(c);
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 0);
      assert.equal(await f.prisma.serviceReservation.count({ where: { orderId: order.id } }), 0);
      assert.ok(readFulfillment(order.fulfillmentJson)!.units.every(u => u.attention === "service_capacity_unavailable"));
      assert.deepEqual(await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.money.id } }), before);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.money.id } }), 0);
    });
    await t.test("late projection SQL failure rolls back all unit effects and a clean redelivery commits once", async () => {
      const c = await prepare("projection-rollback"), before = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.money.id } });
      await f.runtime.db.sql("CREATE FUNCTION t35_reject_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_t35_projection_rollback'; END $$; CREATE TRIGGER t35_reject_projection BEFORE INSERT ON service_reservations FOR EACH ROW EXECUTE FUNCTION t35_reject_projection();");
      try { await assert.rejects(deliver!(c.event), /synthetic_t35_projection_rollback/);
        assert.equal(await f.prisma.completedOrder.count({ where: { sessionId: c.sessionId } }), 0);
        assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.money.id } }), 0);
        assert.equal(await f.prisma.serviceAppointment.count({ where: { buyerGlobalUserId: "complete-buyer-projection-rollback" } }), 0);
        assert.deepEqual(await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.money.id } }), before);
      } finally { await f.runtime.db.sql("DROP TRIGGER t35_reject_projection ON service_reservations; DROP FUNCTION t35_reject_projection();"); }
      await deliver!(c.event); const order = await orderFor(c); assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 2);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.money.id, status: "approved" } }), 2);
      assert.equal(await f.prisma.inventoryMovement.count(), 0);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { closeServiceSlotStore(); redis?.disconnect(); if (previousRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedis; await f.close(); }
});

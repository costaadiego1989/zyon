import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CheckoutSession, CompleteOrderRequest } from "@zyon/shared-types";
import type { DomainEvent, DomainEventBus } from "../src/shared/events/domain-event-bus.port.js";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture, serviceBookingRequest } from "./service-booking-fixtures.js";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentApprovalReader } from "../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { snapshotOrderLines } from "../src/modules/operations/domain/order-fulfillment.js";
import { admitServiceAppointment } from "../src/shared/bookings/service-appointment-admission.service.js";
import { initializeOrderFulfillment } from "../src/shared/persistence/order-fulfillment.js";
import { professionalSlotId } from "../src/shared/bookings/service-checkout-selection.js";
import { InventoryOnOrderCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-order-completed.handler.js";
import { OnSaleCompletedHandler } from "../src/modules/inventory/infrastructure/event-handlers/on-sale-completed.handler.js";
import { HandleSaleCompletedUseCase } from "../src/modules/inventory/application/use-cases/handle-sale-completed.use-case.js";
import { MarketplaceStockPushService } from "../src/modules/inventory/application/services/marketplace-stock-push.service.js";
import { PrismaInventorySaleRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-inventory-sale.repository.js";
import { PrismaInventoryRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-inventory.repository.js";
import { PrismaErpRepository } from "../src/modules/inventory/infrastructure/repositories/prisma-erp.repository.js";

// REG-03 / BOOK-05 / BOOK-10: real local order, approval, stock and appointment
// persistence. Approved payment rows are synthetic; no PSP or delivery is used.
test("T35 products retain paid stock conservation beside canonical services", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let prisma: PrismaClient | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    const raw = prisma = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
    const now = new Date(), merchantId = "stock-products", foreignId = "stock-products-foreign";
    await seedServiceBookingFixture(raw, now);
    for (const id of [merchantId, foreignId]) await raw.merchant.create({ data: { id, name: "Synthetic stock " + id,
      businessMode: "products", businessModeSelectedAt: now } });
    const catalog = async (owner: string, sku: string) => {
      const product = await raw.product.create({ data: { merchantId: owner, name: "Synthetic " + sku, type: "physical",
        variants: { create: { sku, price: { create: { basePriceInCents: 3000, currency: "BRL" } }, stock: { create: { quantity: 10, reserved: 1 } } } } },
        include: { variants: { include: { stock: true } } } });
      const variant = product.variants[0]!;
      const location = await raw.inventoryLocation.create({ data: { merchantId: owner, name: "Synthetic default", isDefault: true } });
      const item = await raw.inventoryItem.create({ data: { merchantId: owner, locationId: location.id, sku,
        productName: product.name, quantity: 10, reserved: 1 } });
      return { product, variant, item, stock: variant.stock[0]! };
    };
    const physical = await catalog(merchantId, "STOCK_PHYSICAL"), foreign = await catalog(foreignId, "STOCK_FOREIGN");
    const repository = new PrismaCheckoutRepository(raw);
    const complete = new CompleteOrderUseCase(repository, repository, repository,
      undefined, undefined, undefined, undefined, repository,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      new PrismaPaymentApprovalReader(raw));
    let providerCalls = 0;
    const push = new MarketplaceStockPushService(new PrismaErpRepository(raw), new PrismaInventoryRepository(raw), {
      getValidAccessToken: async () => { providerCalls++; throw new Error("unexpected_external_stock_provider"); },
    });
    const bus: DomainEventBus = { subscribe: () => {}, handlersFor: () => [],
      publish: async () => { throw new Error("unexpected_external_event_dispatch"); } };
    const inventory = new InventoryOnOrderCompletedHandler(bus,
      new HandleSaleCompletedUseCase(new OnSaleCompletedHandler(new PrismaInventorySaleRepository(raw)), push), repository);
    const stockState = async () => ({
      stocks: await raw.productStock.findMany({ orderBy: { id: "asc" } }),
      items: await raw.inventoryItem.findMany({ orderBy: { id: "asc" } }),
      movements: await raw.inventoryMovement.findMany({ orderBy: { id: "asc" } }),
      receipts: await raw.inventorySaleReceipt.findMany({ orderBy: { id: "asc" } }),
      jobs: await raw.outboxMessage.findMany({ where: { producer: "inventory" }, orderBy: { eventId: "asc" },
        select: { eventId: true, merchantId: true, eventType: true, correlationId: true, causationId: true, payload: true } }),
    });
    const committedState = async () => ({ stock: await stockState(),
      orders: await raw.completedOrder.findMany({ orderBy: { id: "asc" } }),
      appointments: await raw.serviceAppointment.findMany({ orderBy: { id: "asc" } }),
      audits: await raw.appointmentAudit.findMany({ orderBy: { id: "asc" } }),
      events: await raw.outboxMessage.findMany({ orderBy: { eventId: "asc" },
        select: { eventId: true, merchantId: true, eventType: true, correlationId: true, causationId: true, payload: true } }),
    });
    const approvedPhysical = async (label: string) => {
      const sessionId = "stock-session-" + label, providerId = "stock-provider-" + label;
      const cart: CheckoutSession["cart"] = { currency: "BRL", total: 60, currentDiscount: 0, items: [{
        sku: physical.variant.sku, variantId: physical.variant.id, product_id: physical.product.id, name: physical.product.name,
        productType: "physical", fulfillmentStrategy: "carrier", quantity: 2, price: 30,
      }] };
      const shipping = { customerPrice: 12, carrier: "Synthetic carrier", method: "Synthetic selected delivery", deliveryDays: 2 };
      await raw.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: "stock-buyer", conversationId: sessionId,
        cart: JSON.parse(JSON.stringify(cart)), shipping, customer: { fullName: "Synthetic buyer", email: "buyer@example.test" }, createdAt: now, updatedAt: now } });
      const intent = await raw.paymentIntent.create({ data: { id: "stock-intent-" + label, merchantId, sessionId, idempotencyKey: sessionId,
        amountCents: 7349, approvedAmountCents: 7349, currency: "BRL", method: "pix", status: "approved", providerPaymentId: providerId,
        amountBreakdown: { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint({ cart, shipping }),
          itemsSubtotalCents: 6000, discountCents: 0, shippingCents: 1200, platformFeeCents: 149, totalCents: 7349 } } });
      const input: CompleteOrderRequest = { merchant_id: merchantId, session_id: sessionId, external_order_id: providerId,
        order_total: 72, currency: "BRL" };
      return { intent, input };
    };
    const orderEvent = async (externalOrderId: string): Promise<DomainEvent> => {
      const rows = await raw.outboxMessage.findMany({ where: { merchantId, eventType: "order.completed", causationId: externalOrderId } });
      assert.equal(rows.length, 1);
      const row = rows[0]!;
      return { eventId: row.eventId, eventType: row.eventType, merchantId: row.merchantId, payload: row.payload };
    };

    await t.test("physical approval keeps totals and decrements both ledgers exactly once across redelivery", async () => {
      const sale = await approvedPhysical("first");
      assert.equal((await complete.executePaymentApproval(sale.input, sale.intent.id)).idempotent, false);
      assert.equal((await complete.executePaymentApproval(sale.input, sale.intent.id)).idempotent, true);
      const order = await raw.completedOrder.findFirstOrThrow({ where: { merchantId, sessionId: sale.input.session_id } });
      assert.equal(Number(order.orderTotal), 72); assert.equal(order.shippingCents, 1200); assert.equal(order.currency, "BRL");
      const event = await orderEvent(sale.input.external_order_id), payload = event.payload as Record<string, unknown>;
      assert.deepEqual((payload.inventory_sale as { items: unknown[] }).items,
        [{ sku: physical.variant.sku, variantId: physical.variant.id, productType: "physical", quantity: 2 }]);
      assert.deepEqual(payload.payment_amount_breakdown, sale.intent.amountBreakdown);
      assert.equal(payload.payment_intent_id, sale.intent.id);
      await Promise.all([inventory.handle(event), inventory.handle(event)]);
      const after = await stockState();
      await inventory.handle(event);
      assert.deepEqual(await stockState(), after);
      assert.equal((await raw.inventoryItem.findUniqueOrThrow({ where: { id: physical.item.id } })).quantity, 8);
      const projected = await raw.productStock.findUniqueOrThrow({ where: { id: physical.stock.id } });
      assert.equal(projected.quantity, 8); assert.equal(projected.reserved, 1);
      assert.equal((await raw.inventoryItem.findUniqueOrThrow({ where: { id: foreign.item.id } })).quantity, 10);
      const movements = await raw.inventoryMovement.findMany({ where: { merchantId } });
      assert.equal(movements.length, 1);
      assert.equal(movements[0]!.kind, "EXIT"); assert.equal(movements[0]!.quantity, 2);
      assert.equal(movements[0]!.externalRef, sale.input.external_order_id);
      assert.equal(await raw.inventorySaleReceipt.count({ where: { merchantId } }), 1);
      assert.equal(after.jobs.length, 3);
      assert.equal(await raw.serviceAppointment.count({ where: { merchantId } }), 0);
    });

    await t.test("approved canonical service projection and retries retain one appointment with no physical side effect", async () => {
      const beforeStock = await stockState(), serviceMerchant = "booking-services";
      await raw.serviceBusinessPolicy.update({ where: { merchantId: serviceMerchant }, data: { paymentMode: "online", version: 2 } });
      const date = new Date(now.getTime() + 2 * 86400_000).toISOString().slice(0, 10);
      const input = serviceBookingRequest(date, "stock-service-admission", { policyVersion: 2, confirmation: {
        kind: "approved_order_unit", orderId: "stock-service-order", unitId: "line_1",
      } });
      const selection = { productId: input.productId, variantId: input.variantId, professionalId: input.professionalId,
        professionalVersion: input.professionalVersion, policyVersion: input.policyVersion, date,
        startsAt: input.startsAt, endsAt: input.endsAt, timeZone: "UTC", durationMinutes: 20, priceInCents: 5000, currency: "BRL" };
      const lines = snapshotOrderLines([{ sku: input.productId, variantId: input.variantId, name: "Synthetic service", productType: "service",
        fulfillmentStrategy: "scheduled_service", quantity: 1, price: 50, fulfillmentSchedule: {
          slotId: professionalSlotId(serviceMerchant, selection), professionalId: input.professionalId,
          professionalVersion: input.professionalVersion, policyVersion: 2, date, startsAt: input.startsAt, endsAt: input.endsAt,
          timeZone: "UTC", durationMinutes: 20,
        } }]);
      await raw.checkoutSession.create({ data: { merchantId: serviceMerchant, sessionId: "stock-service-session",
        globalUserId: input.buyerGlobalUserId!, conversationId: "stock-service-session", cart: { currency: "BRL", items: [] }, createdAt: now, updatedAt: now } });
      const payment = await raw.paymentIntent.create({ data: { id: "stock-service-intent", merchantId: serviceMerchant, sessionId: "stock-service-session",
        idempotencyKey: "stock-service-payment", amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", method: "pix",
        status: "approved", providerPaymentId: "stock-service-provider" } });
      await raw.completedOrder.create({ data: { id: "stock-service-order", merchantId: serviceMerchant, sessionId: "stock-service-session",
        externalOrderId: "stock-service-provider", orderTotal: 50, currency: "BRL", completedAt: now, lineItemsJson: JSON.parse(JSON.stringify(lines)) } });
      const first = await raw.$transaction(tx => admitServiceAppointment(tx, input));
      await raw.$transaction(tx => initializeOrderFulfillment(tx, "stock-service-order", serviceMerchant));
      await raw.$transaction(tx => initializeOrderFulfillment(tx, "stock-service-order", serviceMerchant));
      const replay = await raw.$transaction(tx => admitServiceAppointment(tx, input));
      assert.equal(replay.replayed, true); assert.equal(replay.appointment.id, first.appointment.id);
      assert.equal(await raw.serviceAppointment.count({ where: { orderId: "stock-service-order" } }), 1);
      const appointment = await raw.serviceAppointment.findUniqueOrThrow({ where: { id: first.appointment.id } });
      assert.equal(appointment.operationalStatus, "scheduled"); assert.equal(appointment.orderUnitId, "line_1");
      assert.equal(appointment.professionalId, input.professionalId); assert.equal(appointment.priceInCents, 5000);
      assert.equal(appointment.startsAt.toISOString(), input.startsAt); assert.equal(appointment.endsAt.toISOString(), input.endsAt);
      const reservation = await raw.serviceReservation.findUniqueOrThrow({ where: { orderId_unitId: { orderId: "stock-service-order", unitId: "line_1" } } });
      assert.equal(reservation.status, "reserved"); assert.equal(reservation.startsAt.toISOString(), input.startsAt);
      assert.deepEqual(await raw.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } }), payment);
      assert.equal(await raw.appointmentAudit.count({ where: { appointmentId: appointment.id } }), 1);
      const events = await raw.outboxMessage.findMany({ where: { producer: "service-booking", correlationId: appointment.id } });
      assert.equal(events.length, 1); assert.equal(events[0]!.eventType, "service.appointment.scheduled");
      assert.deepEqual(events[0]!.payload, { appointmentId: appointment.id, version: 1, operationalStatus: "scheduled" });
      assert.deepEqual(await stockState(), beforeStock);
      assert.equal(await raw.productStock.count({ where: { variantId: input.variantId } }), 0);
      assert.equal(await raw.inventorySaleReceipt.count({ where: { merchantId: serviceMerchant } }), 0);
    });

    await t.test("wrong payment tenant session provider currency or approved total cannot mutate commerce state", async () => {
      const sale = await approvedPhysical("guard");
      for (const change of [ { merchant_id: foreignId }, { session_id: "wrong-session" },
        { external_order_id: "wrong-provider" }, { currency: "USD" as const }, { order_total: 71.99 } ]) {
        const before = await committedState();
        await assert.rejects(complete.executePaymentApproval({ ...sale.input, ...change }, sale.intent.id), /payment_approval_mismatch/);
        assert.deepEqual(await committedState(), before);
      }
      for (const change of [{ status: "pending" }, { approvedAmountCents: 7348 }]) {
        await raw.paymentIntent.update({ where: { id: sale.intent.id }, data: change });
        const before = await committedState();
        await assert.rejects(complete.executePaymentApproval(sale.input, sale.intent.id), /payment_approval_mismatch/);
        assert.deepEqual(await committedState(), before);
        await raw.paymentIntent.update({ where: { id: sale.intent.id }, data: { status: "approved", approvedAmountCents: 7349 } });
      }
      assert.equal(await raw.completedOrder.count({ where: { sessionId: sale.input.session_id } }), 0);
    });

    await t.test("foreign mixed allocation and a real late SQL fault preserve every balance before safe retry", async () => {
      const sale = await approvedPhysical("rollback");
      await complete.executePaymentApproval(sale.input, sale.intent.id);
      const event = await orderEvent(sale.input.external_order_id), payload = event.payload as Record<string, unknown>;
      const snapshot = payload.inventory_sale as Record<string, unknown> & { items: unknown[] };
      const mixed = { ...event, payload: { ...payload, inventory_sale: { ...snapshot, items: [...snapshot.items,
        { sku: foreign.variant.sku, variantId: foreign.variant.id, productType: "physical", quantity: 1 }] } } };
      const before = await committedState();
      await assert.rejects(inventory.handle(mixed), /inventory_catalog_variant_mismatch/);
      assert.deepEqual(await committedState(), before);
      await db.sql(`CREATE FUNCTION synthetic_stock_job_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.producer = 'inventory' AND NEW.causation_id = 'stock-provider-rollback' THEN RAISE EXCEPTION 'synthetic_stock_job_failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_stock_job_failure BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_stock_job_failure();`);
      try {
        await assert.rejects(inventory.handle(event), /synthetic_stock_job_failure/);
        assert.deepEqual(await committedState(), before);
      } finally {
        await db.sql("DROP TRIGGER synthetic_stock_job_failure ON outbox_messages; DROP FUNCTION synthetic_stock_job_failure();");
      }
      await inventory.handle(event);
      const after = await committedState();
      await inventory.handle(event);
      assert.deepEqual(await committedState(), after);
      assert.equal((await raw.inventoryItem.findUniqueOrThrow({ where: { id: physical.item.id } })).quantity, 6);
      assert.equal((await raw.productStock.findUniqueOrThrow({ where: { id: physical.stock.id } })).quantity, 6);
      assert.equal((await raw.productStock.findUniqueOrThrow({ where: { id: foreign.stock.id } })).quantity, 10);
      assert.equal(await raw.inventorySaleReceipt.count({ where: { merchantId } }), 2);
      assert.equal(await raw.inventoryMovement.count({ where: { merchantId, kind: "EXIT" } }), 2);
      assert.equal(await raw.outboxMessage.count({ where: { merchantId, producer: "inventory" } }), 6);
    });
    assert.equal(await raw.erpConnection.count(), 0);
    assert.equal(providerCalls, 0);
  } finally {
    try { if (prisma) await prisma.$disconnect(); }
    finally { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
  }
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { OnShipmentDeliveredHandler } from "./on-shipment-delivered.handler.js";

describe("OnShipmentDeliveredHandler", () => {
  it("marks the tenant order delivered and publishes order.delivered", async () => {
    const eventBus = new InMemoryDomainEventBus();
    const calls: Array<Record<string, unknown>> = [];
    const emitted: string[] = [];
    eventBus.subscribe("order.delivered", async (event) => {
      emitted.push(event.eventType);
    });

    const handler = new OnShipmentDeliveredHandler(eventBus, {
      shipment: {
        findFirst: async ({ where }: { where: { id: string; merchantId: string } }) =>
          where.id === "shipment_1" && where.merchantId === "merchant_1"
            ? { id: "shipment_1", merchantId: "merchant_1", externalOrderId: "order_1", sessionId: "checkout_1", status: "delivered" }
            : null,
      },
      crossStoreLineItem: { findFirst: async () => null },
      marketplaceFundingPlan: { findFirst: async () => null },
      completedOrder: {
        findMany: async () => [],
        updateMany: async (input: Record<string, unknown>) => {
          calls.push(input);
          return { count: 1 };
        },
      },
    } as any);
    handler.onModuleInit();

    await eventBus.publish({
      eventType: "shipment.delivered",
      merchantId: "merchant_1",
      payload: { shipment_id: "shipment_1", delivered_at: "2026-09-06T13:00:00.000Z" },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      where: {
        merchantId: "merchant_1",
        externalOrderId: "order_1",
        status: { in: ["shipped", "approved", "paid"] },
      },
      data: { status: "delivered" },
    });
    assert.deepEqual(emitted, ["order.delivered"]);
  });

  for (const scenario of ["missing_id", "unknown_shipment", "foreign_merchant", "not_delivered", "marketplace_line", "marketplace_funding"] as const) {
    it(`does not mark an ordinary order delivered for ${scenario}`, async () => {
      const fixture = deliveryFixture(scenario);
      await fixture.eventBus.publish({ eventType: "shipment.delivered", merchantId: "merchant_1",
        payload: { shipment_id: scenario === "missing_id" ? undefined : "shipment_1", delivered_at: "2026-10-01T12:00:00.000Z" } });
      assert.equal(fixture.updates.length, 0);
      assert.equal(fixture.emitted.length, 0);
      assert.equal(fixture.transactions.length, 0);
      assert.equal(fixture.shipmentReads.length, scenario === "missing_id" ? 0 : 1);
      if (scenario !== "missing_id") assert.deepEqual(fixture.shipmentReads[0], { where: { id: "shipment_1", merchantId: "merchant_1" } });
    });
  }

  it("propagates typed fulfillment projection failure instead of falling back to legacy delivery", async () => {
    const fixture = deliveryFixture("typed_projection_failure");
    await assert.rejects(() => fixture.eventBus.publish({ eventType: "shipment.delivered", merchantId: "merchant_1",
      payload: { shipment_id: "shipment_1" } }), /synthetic_projection_failed/);
    assert.equal(fixture.transactions.length, 1);
    assert.equal(fixture.updates.length, 0);
    assert.equal(fixture.emitted.length, 0);
  });
});

function deliveryFixture(scenario: string) {
  const eventBus = new InMemoryDomainEventBus();
  const shipmentReads: unknown[] = [], updates: unknown[] = [], emitted: unknown[] = [], transactions: unknown[] = [];
  eventBus.subscribe("order.delivered", async event => { emitted.push(event); });
  const handler = new OnShipmentDeliveredHandler(eventBus, {
    shipment: { findFirst: async (input: unknown) => {
      shipmentReads.push(input);
      return scenario === "unknown_shipment" ? null : { id: "shipment_1", merchantId: scenario === "foreign_merchant" ? "merchant_foreign" : "merchant_1",
        externalOrderId: "order_1", sessionId: "checkout_1", status: scenario === "not_delivered" ? "in_transit" : "delivered" };
    } },
    crossStoreLineItem: { findFirst: async (input: { where: { hostMerchantId: string } }) => {
      assert.equal(input.where.hostMerchantId, "merchant_1");
      return scenario === "marketplace_line" ? { id: "cross_store_line" } : null;
    } },
    marketplaceFundingPlan: { findFirst: async (input: { where: { hostMerchantId: string; payment: { merchantId: string } } }) => {
      assert.equal(input.where.hostMerchantId, "merchant_1"); assert.equal(input.where.payment.merchantId, "merchant_1");
      return scenario === "marketplace_funding" ? { paymentIntentId: "funding_1" } : null;
    } },
    completedOrder: {
      findMany: async (input: { where: { merchantId: string }; select?: { fulfillmentJson?: boolean } }) => {
        assert.equal(input.where.merchantId, "merchant_1");
        return scenario === "typed_projection_failure" && input.select?.fulfillmentJson ? [{ fulfillmentJson: { version: 1 } }] : [];
      },
      updateMany: async (input: unknown) => { updates.push(input); return { count: 1 }; },
    },
    $transaction: async (callback: unknown) => { transactions.push(callback); throw new Error("synthetic_projection_failed"); },
  } as never);
  handler.onModuleInit();
  return { eventBus, shipmentReads, updates, emitted, transactions };
}

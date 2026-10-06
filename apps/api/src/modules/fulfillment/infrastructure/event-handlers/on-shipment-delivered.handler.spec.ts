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
          where.id === "shipment_1"
            ? { merchantId: "merchant_1", externalOrderId: "order_1", sessionId: "session_1", status: "delivered" }
            : null,
      },
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

  it("ignores a funded marketplace shipment even when its legacy status says delivered", async () => {
    const eventBus = new InMemoryDomainEventBus();
    const effects: string[] = [];
    eventBus.subscribe("order.delivered", async () => { effects.push("event"); });
    const handler = new OnShipmentDeliveredHandler(eventBus, {
      shipment: { findFirst: async () => ({ merchantId: "host", externalOrderId: "provider", sessionId: "payment-session", status: "delivered" }) },
      marketplaceFundingPlan: { findFirst: async ({ where }: any) => {
        assert.equal(where.hostMerchantId, "host");
        assert.deepEqual(where.payment, { merchantId: "host" });
        return { paymentIntentId: "funded" };
      } },
      completedOrder: { updateMany: async () => { effects.push("update"); return { count: 1 }; } },
    } as any);
    handler.onModuleInit();
    await eventBus.publish({ eventType: "shipment.delivered", merchantId: "host", payload: { shipment_id: "one-origin" } });
    assert.deepEqual(effects, []);
  });

  for (const shipment of [null, { merchantId: "other", status: "delivered" }, { merchantId: "host", status: "in_transit" }]) {
    it(`rejects a missing, foreign or unproved shipment (${shipment?.merchantId ?? "missing"}/${shipment?.status ?? "missing"})`, async () => {
      const eventBus = new InMemoryDomainEventBus();
      const effects: string[] = [];
      const lookups: any[] = [];
      const handler = new OnShipmentDeliveredHandler(eventBus, {
        shipment: { findFirst: async ({ where }: any) => { lookups.push(where); return shipment; } },
        marketplaceFundingPlan: { findFirst: async () => { effects.push("funding"); return null; } },
        completedOrder: { updateMany: async () => { effects.push("update"); return { count: 1 }; } },
      } as any);
      eventBus.subscribe("order.delivered", async () => { effects.push("event"); });
      handler.onModuleInit();
      await eventBus.publish({ eventType: "shipment.delivered", merchantId: "host", payload: { shipment_id: "shipment" } });
      assert.deepEqual(lookups, [{ id: "shipment", merchantId: "host" }]);
      assert.deepEqual(effects, []);
    });
  }
});

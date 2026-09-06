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
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === "shipment_1"
            ? { merchantId: "merchant_1", externalOrderId: "order_1" }
            : null,
      },
      completedOrder: {
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
});

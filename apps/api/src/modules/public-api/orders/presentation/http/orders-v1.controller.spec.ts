import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrdersV1Controller } from "./orders-v1.controller.js";

describe("OrdersV1Controller", () => {
  it("persists tracking through the tracking updater instead of the order status command", async () => {
    const calls: unknown[] = [];
    const controller = new OrdersV1Controller(
      {} as never,
      {
        execute: async () => ({
          id: "ord_1",
          sessionId: "session_1",
          externalOrderId: "external_1",
        }),
      } as never,
      {} as never,
      {} as never,
      {
        execute: async (input: unknown) => {
          calls.push(input);
          return {
            updated: true,
            changed: true,
            order: { trackingCode: "BR123456789" },
            shipment: { status: "in_transit" },
            events_recorded: 1,
          };
        },
      } as never,
    );

    const response = await controller.updateTracking(
      { tenantPrincipal: { tenantId: "mrc_1" } },
      "ord_1",
      {
        tracking_code: "BR123456789",
        carrier: "Correios",
        tracking_url: "https://rastreamento.example/BR123456789",
        status: "in_transit",
        events: [{ status: "in_transit", description: "Em tr\u00e2nsito" }],
      },
    );

    assert.deepEqual(calls, [{
      merchantId: "mrc_1",
      externalOrderId: "external_1",
      body: {
        session_id: "session_1",
        tracking_code: "BR123456789",
        carrier: "Correios",
        tracking_url: "https://rastreamento.example/BR123456789",
        status: "in_transit",
        events: [{ status: "in_transit", description: "Em tr\u00e2nsito" }],
      },
    }]);
    assert.deepEqual(response, {
      updated: true,
      order_id: "ord_1",
      status: "in_transit",
      tracking_code: "BR123456789",
    });
  });

  it("keeps the original status-only contract without calling the tracking updater", async () => {
    const statusCalls: unknown[] = [];
    const trackingCalls: unknown[] = [];
    const controller = new OrdersV1Controller(
      {} as never,
      {
        execute: async () => ({
          id: "ord_1",
          sessionId: "session_1",
          externalOrderId: "external_1",
        }),
      } as never,
      {} as never,
      {
        execute: async (input: unknown) => {
          statusCalls.push(input);
          return { id: "ord_1", status: "shipped" };
        },
      } as never,
      { execute: async (input: unknown) => { trackingCalls.push(input); } } as never,
    );

    const response = await controller.updateTracking(
      { tenantPrincipal: { tenantId: "mrc_1" } },
      "ord_1",
      { status: "shipped" },
    );

    assert.deepEqual(statusCalls, [{ merchantId: "mrc_1", orderId: "ord_1", status: "shipped" }]);
    assert.deepEqual(trackingCalls, []);
    assert.deepEqual(response, {
      updated: true,
      order_id: "ord_1",
      status: "shipped",
      tracking_code: null,
    });
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { CompletedOrderEntity } from "./completed-order.entity.js";
import { completeOrderRequest } from "../../__tests__/checkout-test-fixtures.js";

test("CompletedOrderEntity records order completion and stable idempotency key", () => {
  const order = CompletedOrderEntity.complete(
    completeOrderRequest({ accepted_offer_id: "off_1" }),
    new Date("2026-05-01T12:00:00.000Z")
  ).snapshot();

  assert.equal(order.externalOrderId, "ord_1");
  assert.equal(order.acceptedOfferId, "off_1");
  assert.equal(order.trackingCode, undefined);
  assert.equal(order.completedAt, "2026-05-01T12:00:00.000Z");
  assert.equal(
    CompletedOrderEntity.idempotencyKey({
      merchantId: "mrc_1",
      sessionId: "chk_1",
      externalOrderId: "ord_1"
    }),
    "mrc_1:chk_1:ord_1"
  );
});

test("CompletedOrderEntity keeps provided tracking code", () => {
  const order = CompletedOrderEntity.complete(
    completeOrderRequest({ tracking_code: "BR123456789AA" }),
    new Date("2026-05-01T12:00:00.000Z")
  ).snapshot();

  assert.equal(order.trackingCode, "BR123456789AA");
});

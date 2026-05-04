import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSessionEntity } from "./checkout-session.entity.js";
import { checkoutSession, testCart } from "../../__tests__/checkout-test-fixtures.js";

test("CheckoutSessionEntity creates a silent session with stable identifiers", () => {
  const session = CheckoutSessionEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_custom",
    globalUserId: "usr_1",
    conversationId: "conv_1",
    cart: testCart()
  }).snapshot();

  assert.equal(session.merchantId, "mrc_1");
  assert.equal(session.sessionId, "chk_custom");
  assert.equal(session.abandonmentScore, 0);
  assert.equal(session.triggerAgent, false);
  assert.ok(session.createdAt);
  assert.ok(session.updatedAt);
});

test("CheckoutSessionEntity updates score immutably and applies trigger threshold", () => {
  const original = CheckoutSessionEntity.rehydrate(checkoutSession());
  const updated = original.updateScore(0.55);

  assert.equal(original.snapshot().triggerAgent, false);
  assert.equal(updated.snapshot().abandonmentScore, 0.55);
  assert.equal(updated.snapshot().triggerAgent, true);
});

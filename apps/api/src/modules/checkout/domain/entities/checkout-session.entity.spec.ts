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

test("CheckoutSessionEntity appendTurn keeps last 50 chat turns", () => {
  let session = CheckoutSessionEntity.create({
    merchantId: "m",
    sessionId: "s",
    globalUserId: "g",
    conversationId: "c",
    cart: testCart()
  });
  for (let i = 0; i < 55; i++) {
    session = session.appendTurn({
      role: i % 2 === 0 ? "buyer" : "agent",
      text: `msg-${i}`,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
    });
  }
  const history = session.snapshot().chatHistory;
  assert.equal(history.length, 50);
  assert.equal(history[0]?.text, "msg-5");
  assert.equal(history[49]?.text, "msg-54");
});

test("CheckoutSessionEntity creates session with empty chatHistory", () => {
  const session = CheckoutSessionEntity.create({
    merchantId: "m",
    sessionId: "s",
    globalUserId: "g",
    conversationId: "c",
    cart: testCart()
  }).snapshot();

  assert.deepEqual(session.chatHistory, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession, simulateCommercialMutation } from "./checkout-test-fixtures.js";

test("ACP fixture uses the real commercial invalidation without granting benefits", async () => {
  const expected = checkoutSession({ cart: { currency: "BRL", total: 100, items: [{ sku: "a", name: "Produto A", price: 100, quantity: 1 }], currentDiscount: 10 } });
  const next = structuredClone(expected); next.cart.items[0].quantity = 2; next.cart.total = 200;
  let saved: unknown;
  const result = await simulateCommercialMutation({ saveSession: async value => { saved = value; }, recordEvent: async () => {} }, { expected, next });
  assert.equal(result.cart.currentDiscount, 0); assert.equal(saved, result);
  assert.equal(expected.cart.currentDiscount, 10); assert.equal(next.cart.currentDiscount, 10);
});

test("ACP fixture rejects tenant changes or invented benefits before saving", async () => {
  let writes = 0;
  const repository = { saveSession: async () => { writes++; }, recordEvent: async () => {} };
  const expected = checkoutSession();
  await assert.rejects(simulateCommercialMutation(repository, { expected, next: { ...expected, merchantId: "foreign" } }), /CHECKOUT_COMMERCIAL_SCOPE_CONFLICT/);
  await assert.rejects(simulateCommercialMutation(repository, { expected, next: { ...expected, cart: { ...expected.cart, currentDiscount: 99 } } }), /CHECKOUT_COMMERCIAL_BENEFIT_WRITE_FORBIDDEN/);
  assert.equal(writes, 0);
});

test("ACP fixture cancellation clears the cart and records the scoped lifecycle event", async () => {
  const events: unknown[] = [], expected = checkoutSession();
  const result = await simulateCommercialMutation({ saveSession: async () => {}, recordEvent: async (...args) => { events.push(args); } }, { expected, next: expected, cancel: true });
  assert.deepEqual(result.cart.items, []); assert.equal(result.cart.total, 0);
  assert.deepEqual(events, [["mrc_1", "chk_1", "checkout_abandoned", { source: "acp.protocol", reason: "buyer_initiated" }]]);
});


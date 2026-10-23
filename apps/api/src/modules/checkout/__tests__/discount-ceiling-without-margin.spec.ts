import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCombinedDiscount, evaluateDiscountOffer } from "@zyon/rules-engine";
import { authorizeShippingDiscount } from "@zyon/shipping-engine";
import type { Cart } from "@zyon/shared-types";
import { merchantRules, checkoutSession } from "./checkout-test-fixtures.js";
import { checkoutBenefitsPolicy } from "../domain/services/checkout-benefits-policy.js";

const cart = (): Cart => ({ currency: "BRL", total: 100,
  items: [{ sku: "synthetic", name: "Produto", price: 100, quantity: 1 }] });
const rules = () => merchantRules({ maxDiscountPercent: 15, minimumMarginPercent: 99 });

for (const mode of ["missing", "expensive", "options", "invalid-cost"] as const) {
  for (const contextual of [false, true]) test(`discount authority ignores ${mode} cost with ${contextual ? "combined" : "standalone"} ceiling`, () => {
    const value = cart();
    if (mode === "expensive") value.items[0].cost = 999;
    if (mode === "options") value.items[0].selected_options = [{ group_name: "Extras", item_name: "Queijo", price_modifier: 5 }];
    if (mode === "invalid-cost") value.items[0].cost = Number.NaN;
    if (contextual) value.discountBudget = { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 0 };
    const result = evaluateDiscountOffer(value, rules(), 30);
    assert.equal(result.approved, true); assert.equal(Math.round(value.total * result.value), 1500);
  });
}

test("promotions and additional target still share one ceiling without a cost model", () => {
  const value = cart(); value.items[0].price = 90; value.total = 90;
  value.items[0].selected_options = [{ group_name: "Extras", item_name: "Queijo", price_modifier: 5 }];
  value.discountBudget = { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1000 };
  const result = evaluateCombinedDiscount(value, rules(), 1000);
  assert.equal(result.kind, "authorized"); assert.equal(result.totalDiscountCents, 1500);
  assert.equal(result.cartDiscountCents, 500); assert.equal(result.remainingDiscountCents, 0);
});

test("ceiling warning remains truthful without product cost or margin authorization", () => {
  const value = cart(); value.currentDiscount = 15;
  const result = evaluateCombinedDiscount(value, rules(), 2000);
  assert.equal(result.kind, "authorized"); assert.equal(result.limitReached, true);
  assert.equal(result.reason, "discount_limit_reached"); assert.equal(result.cartDiscountCents, 1500);
});

for (const mode of ["missing", "expensive", "options"] as const) test(`shipping honors its own limits, not ${mode} product margin`, () => {
  const value = cart();
  if (mode === "expensive") value.items[0].cost = 999;
  if (mode === "options") value.items[0].selected_options = [{ group_name: "Extras", item_name: "Queijo", price_modifier: 5 }];
  const result = authorizeShippingDiscount({ cart: value, rules: { ...rules(), freeShippingMinCartValue: 0 },
    shipping: { customerPrice: 10, realCost: 10, region: "SP" }, requestedDiscount: 10, type: "shipping_free" });
  assert.equal(result.approved, true); assert.equal(result.value, 10);
});

test("checkout progressive benefit has no second hidden margin/cost gate", () => {
  const session = checkoutSession({ cart: cart(), shipping: undefined });
  const result = checkoutBenefitsPolicy({ session, rules: rules(), advancedRules: [], events: ["payment_method_selected"], paymentMethod: "pix",
    progressivePolicy: { enabled: true, stages: { initial_coupon: 0, exit_intent: 0, abandoned_cart: 0, payment_nudge: 20 } } }).session;
  assert.equal(result.cart.currentDiscount, 15);
});

for (const mutation of ["price", "quantity", "total", "empty", "overflow"] as const) test(`removing margin does not remove cart amount validation: ${mutation}`, () => {
  const value = cart();
  if (mutation === "price") value.items[0].price = 100.001;
  if (mutation === "quantity") value.items[0].quantity = 1.5;
  if (mutation === "total") value.total = 99;
  if (mutation === "empty") value.items = [];
  if (mutation === "overflow") value.items[0].quantity = Number.MAX_SAFE_INTEGER;
  assert.equal(evaluateDiscountOffer(value, rules(), 5).approved, false);
  assert.equal(evaluateCombinedDiscount(value, rules(), 500).kind, "blocked");
});

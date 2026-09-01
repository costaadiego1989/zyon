import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantRules } from "@zyon/shared-types";
import type { StorefrontCart } from "../ports/storefront-cart.port.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import { CartRulesEngine, buildCartRuleContext } from "./cart-rules-engine.service.js";
import { RuleProximityEngine } from "./rule-proximity.service.js";

const MERCHANT_RULES: MerchantRules = {
  maxDiscountPercent: 20,
  minimumMarginPercent: 10,
  allowFreeShipping: true,
} as MerchantRules;

function cart(totalCents: number, itemCount = 2): StorefrontCart {
  const unit = itemCount > 0 ? Math.round(totalCents / itemCount) : totalCents;
  return {
    id: "c1",
    merchantId: "mrc_1",
    sessionId: "sess_1",
    items: Array.from({ length: itemCount }, (_, i) => ({
      variantId: `v${i}`,
      productId: `p${i}`,
      name: "RTP-PRODUCT",
      sku: `v${i}`,
      quantity: 1,
      unitPriceCents: unit,
    })),
    couponCode: null,
    discount: 0,
    freeShipping: false,
    total: totalCents,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// A rule authored by the dashboard UI: symbolic operator ">" + string value.
const DISCOUNT_RULE: AdvancedRule = {
  id: "r-disc",
  enabled: true,
  priority: 1,
  conditions: [{ field: "cart_total", operator: ">", value: "100" }],
  action: { type: "offer_discount", params: { percent: 15 } },
};

const FREE_SHIPPING_RULE: AdvancedRule = {
  id: "r-ship",
  enabled: true,
  priority: 2,
  conditions: [{ field: "cart_total", operator: ">=", value: "200" }],
  action: { type: "offer_free_shipping", params: {} },
};

test("cart rules: UI-authored '>' rule applies discount when cart_total exceeds threshold", () => {
  const engine = new CartRulesEngine();
  const c = cart(19980); // R$199.80 > R$100
  const ctx = buildCartRuleContext(c);
  const out = engine.evaluate(c, [DISCOUNT_RULE], MERCHANT_RULES, ctx);
  // 15% of R$199.80 = R$29.97 = 2997 cents
  assert.equal(out.discountCents, 2997);
  assert.equal(out.appliedRuleId, "r-disc");
});

test("cart rules: discount does NOT apply below threshold", () => {
  const engine = new CartRulesEngine();
  const c = cart(5000); // R$50 < R$100
  const out = engine.evaluate(c, [DISCOUNT_RULE], MERCHANT_RULES, buildCartRuleContext(c));
  assert.equal(out.discountCents, 0);
});

test("cart rules: discount hard-capped by merchant maxDiscountPercent", () => {
  const engine = new CartRulesEngine();
  const c = cart(20000);
  const greedy: AdvancedRule = { ...DISCOUNT_RULE, action: { type: "offer_discount", params: { percent: 90 } } };
  const out = engine.evaluate(c, [greedy], MERCHANT_RULES, buildCartRuleContext(c));
  // capped at 20% → R$40 = 4000 cents, never 90%
  assert.equal(out.discountCents, 4000);
});

test("cart rules: free shipping flag set when rule matches and merchant allows", () => {
  const engine = new CartRulesEngine();
  const c = cart(25000); // R$250 >= R$200
  const out = engine.evaluate(c, [FREE_SHIPPING_RULE], MERCHANT_RULES, buildCartRuleContext(c));
  assert.equal(out.freeShipping, true);
});

test("cart rules: free shipping NOT granted when merchant disallows", () => {
  const engine = new CartRulesEngine();
  const c = cart(25000);
  const strict = { ...MERCHANT_RULES, allowFreeShipping: false } as MerchantRules;
  const out = engine.evaluate(c, [FREE_SHIPPING_RULE], strict, buildCartRuleContext(c));
  assert.equal(out.freeShipping, false);
});

test("cart rules: percent discount capped by maxDiscountReais (e.g. 39% max R$10)", () => {
  const engine = new CartRulesEngine();
  // Merchant allows up to 40% so the percent itself is not the binding cap.
  const rules = { ...MERCHANT_RULES, maxDiscountPercent: 40, minimumMarginPercent: 5 } as MerchantRules;
  const capRule: AdvancedRule = {
    id: "r-cap",
    enabled: true,
    priority: 1,
    conditions: [{ field: "cart_total", operator: ">", value: "50" }],
    action: { type: "offer_discount", params: { percent: 39, maxDiscountReais: 10 } },
  };
  const c = cart(10000); // R$100. 39% = R$39, but reais cap = R$10.
  const out = engine.evaluate(c, [capRule], rules, buildCartRuleContext(c));
  // discount clamped to R$10 = 1000 cents, not R$39.
  assert.equal(out.discountCents, 1000);
  assert.equal(out.reason, "capped_by_reais_limit");
});

test("cart rules: idempotent — same cart yields same discount twice", () => {
  const engine = new CartRulesEngine();
  const c = cart(19980);
  const ctx = buildCartRuleContext(c);
  const a = engine.evaluate(c, [DISCOUNT_RULE], MERCHANT_RULES, ctx);
  const b = engine.evaluate(c, [DISCOUNT_RULE], MERCHANT_RULES, ctx);
  assert.equal(a.discountCents, b.discountCents);
});

test("proximity: cart_total gap nudge shows reais remaining", () => {
  const prox = new RuleProximityEngine();
  const c = cart(16000); // R$160, rule needs > R$200 for free shipping
  const res = prox.compute([FREE_SHIPPING_RULE], buildCartRuleContext(c));
  assert.ok(res.nextNudge);
  assert.equal(res.nextNudge?.kind, "cart_total");
  assert.equal(res.nextNudge?.reachable, true);
  // gap = 200 - 160 = 40
  assert.equal(Math.round(res.nextNudge?.gap ?? 0), 40);
  assert.match(res.nextNudge?.message ?? "", /40/);
});

test("proximity: satisfied rule appears as active badge, not a nudge", () => {
  const prox = new RuleProximityEngine();
  const c = cart(25000); // R$250 satisfies free shipping >= 200
  const res = prox.compute([FREE_SHIPPING_RULE], buildCartRuleContext(c));
  assert.equal(res.active.length, 1);
  assert.equal(res.nextNudge, null);
});

test("proximity: smallest-gap rule wins when multiple unmet", () => {
  const prox = new RuleProximityEngine();
  // cart R$160: discount needs >100 (already met → active), free shipping needs >=200 (gap 40)
  const c = cart(16000);
  const res = prox.compute([DISCOUNT_RULE, FREE_SHIPPING_RULE], buildCartRuleContext(c));
  // discount rule satisfied (active), free shipping is the next nudge
  assert.equal(res.nextNudge?.ruleId, "r-ship");
  assert.equal(Math.round(res.nextNudge?.gap ?? 0), 40);
});

test("proximity: cart_item_count gap nudge", () => {
  const prox = new RuleProximityEngine();
  const itemRule: AdvancedRule = {
    id: "r-items",
    enabled: true,
    priority: 1,
    conditions: [{ field: "cart_item_count", operator: ">=", value: "3" }],
    action: { type: "offer_discount", params: { percent: 20 } },
  };
  const c = cart(10000, 1); // 1 item, needs >= 3
  const res = prox.compute([itemRule], buildCartRuleContext(c));
  assert.equal(res.nextNudge?.kind, "cart_item_count");
  assert.equal(res.nextNudge?.gap, 2);
});

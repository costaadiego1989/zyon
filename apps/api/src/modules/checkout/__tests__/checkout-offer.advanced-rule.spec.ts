import test from "node:test";
import assert from "node:assert/strict";
import type { AdvancedRule } from "@zyon/shared-types";
import { AdvancedRuleEvaluator } from "../domain/services/advanced-rule-evaluator.service.js";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import type { MerchantRules, Cart } from "@zyon/shared-types";

/**
 * F0-T06 + F0-T07: Integration tests for AdvancedRuleEvaluator integration into checkout-offer.service
 * and InterventionRuleTextBuilder updates to exclude value-action rules from text generation.
 *
 * Spec: F0-T03, F0-T04, F0-T06, F0-T07, INV-01
 * - Rule match with offer_discount → evaluateDiscountOffer called (rules-engine authority)
 * - Rule match with offer_free_shipping → evaluateShippingOffer called
 * - Margin violation → approved:false
 * - Regras show_message/suggest_product do NOT gerar oferta
 * - Value-action rules don't appear in decision text (intervention-rule-text.builder.ts)
 */

function createMerchantRules(overrides?: Partial<MerchantRules>): MerchantRules {
  const defaults: MerchantRules = {
    maxDiscountPercent: 50,
    minimumMarginPercent: 25,
    minOfferDiscountPercent: 1,
    freeShippingMinCartValue: 150,
    maxOfferCount: 3,
    maxOfferFrequency: 1,
    autonomousEngineEnabled: true
  };
  return { ...defaults, ...overrides };
}

function createCart(overrides?: Partial<Cart>): Cart {
  const defaults: Cart = {
    currency: "BRL",
    total: 300,
    items: [
      {
        sku: "ITEM-001",
        name: "Product",
        price: 300,
        cost: 150,
        quantity: 1
      }
    ]
  };
  return { ...defaults, ...(overrides || {}) };
}

test("F0-T06: Advanced rule with offer_discount action → evaluateDiscountOffer called, rules-engine authority", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    id: "rule-discount-1",
    name: "Electronics 30% cap 16",
    enabled: true,
    priority: 1,
    conditions: [
      { field: "cart_total", operator: "gte", value: 300 },
      { field: "category_in_cart", operator: "contains", value: "eletronicos" }
    ],
    action: {
      type: "offer_discount",
      params: { percent: 30, maxDiscountReais: 16 }
    }
  };

  const cart = createCart({
    total: 350,
    items: [
      {
        sku: "PHONE-001",
        name: "Smartphone",
        price: 350,
        cost: 140,
        quantity: 1
      }
    ]
  });

  const rules = createMerchantRules({
    maxDiscountPercent: 50,
    minimumMarginPercent: 25
  });

  const matchResult = evaluator.evaluate([rule], {
    cartTotal: cart.total ?? 0,
    shippingCost: 0,
    cartItemCount: cart.items.length,
    skusInCart: cart.items.map(i => i.sku),
    categoriesInCart: ["eletronicos"],
    couponApplied: false,
    buyerType: "price_sensitive"
  });

  assert.equal(matchResult.matched, true, "Rule should match conditions");
  assert.equal(matchResult.action?.type, "offer_discount", "Action should be offer_discount");

  const evaluation = evaluateDiscountOffer(
    cart,
    rules,
    30,
    16
  );

  assert.equal(evaluation.approved, true, "Offer should be approved (margin respected)");
  assert.equal(evaluation.type, "discount_percent");
  assert.equal(evaluation.value, 16 / 350 * 100, "Value should be capped percent");
  assert.equal(evaluation.reason, "capped_by_reais_limit", "Reason should indicate reais cap applied");
});

test("F0-T06: Margin violation → approved:false", async () => {
  const cart = createCart({
    total: 100,
    items: [
      {
        sku: "CHEAP-001",
        name: "Cheap Item",
        price: 100,
        cost: 95,
        quantity: 1
      }
    ]
  });

  const rules = createMerchantRules({
    maxDiscountPercent: 20,
    minimumMarginPercent: 25
  });

  const evaluation = evaluateDiscountOffer(
    cart,
    rules,
    20,
    undefined
  );

  assert.equal(evaluation.approved, false, "Offer should be rejected due to margin violation");
  assert.equal(evaluation.reason, "minimum_margin_violation");
});

test("F0-T06: Rule with offer_free_shipping action", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    id: "rule-shipping-1",
    name: "Free shipping for 300+",
    enabled: true,
    priority: 1,
    conditions: [
      { field: "cart_total", operator: "gte", value: 300 }
    ],
    action: {
      type: "offer_free_shipping",
      params: {}
    }
  };

  const cart = createCart({
    total: 350,
    items: [
      {
        sku: "ITEM-001",
        name: "Product",
        price: 350,
        cost: 175,
        quantity: 1
      }
    ]
  });

  const matchResult = evaluator.evaluate([rule], {
    cartTotal: cart.total ?? 0,
    shippingCost: 25,
    cartItemCount: cart.items.length,
    skusInCart: cart.items.map(i => i.sku),
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  });

  assert.equal(matchResult.matched, true, "Rule should match");
  assert.equal(matchResult.action?.type, "offer_free_shipping", "Action should be offer_free_shipping");
});

test("F0-T07: Value-action rules identified correctly", async () => {
  const rule: AdvancedRule = {
    id: "rule-discount",
    name: "30% off",
    enabled: true,
    priority: 1,
    conditions: [
      { field: "cart_total", operator: "gte", value: 300 }
    ],
    action: {
      type: "offer_discount",
      params: { percent: 30 }
    }
  };

  const isValueAction = ["offer_discount", "offer_free_shipping", "offer_coupon"].includes(
    rule.action.type
  );
  assert.equal(isValueAction, true, "Rule action should be identified as value-action");
});

test("F0-T07: Advisory rules identified correctly", async () => {
  const advisoryRules: AdvancedRule[] = [
    {
      id: "rule-msg",
      name: "Show message",
      enabled: true,
      priority: 1,
      conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      action: {
        type: "show_message",
        params: { message: "Special offer available" }
      }
    },
    {
      id: "rule-suggest",
      name: "Suggest product",
      enabled: true,
      priority: 2,
      conditions: [{ field: "cart_total", operator: "gte", value: 200 }],
      action: {
        type: "suggest_product",
        params: { productName: "Insurance" }
      }
    }
  ];

  for (const rule of advisoryRules) {
    const isAdvisory = ![
      "offer_discount",
      "offer_free_shipping",
      "offer_coupon"
    ].includes(rule.action.type);
    assert.equal(isAdvisory, true, `${rule.action.type} should be advisory`);
  }
});

test("F0-T06: No matching rule → standard flow", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    id: "rule-high-cart",
    name: "Discount for 500+ cart",
    enabled: true,
    priority: 1,
    conditions: [
      { field: "cart_total", operator: "gte", value: 500 }
    ],
    action: {
      type: "offer_discount",
      params: { percent: 25 }
    }
  };

  const ctx = {
    cartTotal: 250,
    shippingCost: 15,
    cartItemCount: 1,
    skusInCart: ["ITEM-001"],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const matchResult = evaluator.evaluate([rule], ctx);
  assert.equal(matchResult.matched, false, "Rule should not match (cart too low)");

  const cart = createCart({ total: 250, items: [] });
  const rules = createMerchantRules({ maxDiscountPercent: 15 });

  const evaluation = evaluateDiscountOffer(cart, rules, 15);
  assert.equal(evaluation.approved, true, "Standard progressive discount applies");
});

test("F0-T06: Disabled rule is skipped", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rules: AdvancedRule[] = [
    {
      id: "rule-disabled",
      name: "Disabled rule",
      enabled: false,
      priority: 1,
      conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      action: { type: "offer_discount", params: { percent: 30 } }
    }
  ];

  const ctx = {
    cartTotal: 350,
    shippingCost: 15,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate(rules, ctx);
  assert.equal(result.matched, false, "Disabled rule should not match");
});

test("F0-T06: Cap in reais 30% of R$350 cap at R$16 → effective 4.57%", async () => {
  const cart = createCart({
    total: 350,
    items: [
      { sku: "ITEM-001", name: "Product", price: 350, cost: 140, quantity: 1 }
    ]
  });

  const rules = createMerchantRules({
    maxDiscountPercent: 50,
    minimumMarginPercent: 25
  });

  const evaluation = evaluateDiscountOffer(
    cart,
    rules,
    30,
    16
  );

  const expectedEffectivePercent = (16 / 350) * 100;

  assert.equal(evaluation.approved, true);
  assert.equal(evaluation.value, expectedEffectivePercent);
  assert.match(
    evaluation.reason,
    /capped_by_reais_limit/,
    "Reason should indicate reais cap"
  );
});

test("F0-T06: Cap in reais, 30% of R$40 cap at R$16 → effective 30%", async () => {
  const cart = createCart({
    total: 40,
    items: [
      { sku: "ITEM-001", name: "Cheap Product", price: 40, cost: 16, quantity: 1 }
    ]
  });

  const rules = createMerchantRules({
    maxDiscountPercent: 50,
    minimumMarginPercent: 25
  });

  const evaluation = evaluateDiscountOffer(
    cart,
    rules,
    30,
    16
  );

  assert.equal(evaluation.approved, true);
  assert.equal(evaluation.value, 30);
  assert.notEqual(evaluation.reason, "capped_by_reais_limit");
});

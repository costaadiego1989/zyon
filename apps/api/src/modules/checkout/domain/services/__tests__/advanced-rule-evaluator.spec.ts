import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AdvancedRuleEvaluator,
  type AdvancedRule,
  type RuleMatchContext
} from "../advanced-rule-evaluator.service.js";

test("AdvancedRuleEvaluator — AND conditions match", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rules: AdvancedRule[] = [
    {
      id: "rule-1",
      enabled: true,
      priority: 1,
      conditions: [
        { field: "cart_total", operator: "gte", value: 300 },
        { field: "category_in_cart", operator: "contains", value: "eletronicos" }
      ],
      action: { type: "offer_discount", params: { percent: 30, maxDiscountReais: 16 } }
    }
  ];

  const ctx: RuleMatchContext = {
    cartTotal: 350,
    shippingCost: 15,
    cartItemCount: 2,
    skusInCart: ["SKU-001", "SKU-002"],
    categoriesInCart: ["eletronicos", "acessorios"],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate(rules, ctx);
  assert.equal(result.matched, true);
  assert.equal(result.rule?.id, "rule-1");
  assert.equal(result.action?.type, "offer_discount");
});

test("AdvancedRuleEvaluator — all conditions must match (AND)", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rules: AdvancedRule[] = [
    {
      id: "rule-1",
      enabled: true,
      priority: 1,
      conditions: [
        { field: "cart_total", operator: "gte", value: 300 },
        { field: "category_in_cart", operator: "contains", value: "eletronicos" }
      ],
      action: { type: "offer_discount", params: { percent: 30 } }
    }
  ];

  const ctx: RuleMatchContext = {
    cartTotal: 350,
    shippingCost: 15,
    cartItemCount: 2,
    skusInCart: ["SKU-001"],
    categoriesInCart: ["acessorios"], // NOT eletronicos
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate(rules, ctx);
  assert.equal(result.matched, false);
});

test("AdvancedRuleEvaluator — priority order (lower number wins)", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rules: AdvancedRule[] = [
    {
      id: "rule-2",
      enabled: true,
      priority: 2,
      conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      action: { type: "offer_discount", params: { percent: 10 } }
    },
    {
      id: "rule-1",
      enabled: true,
      priority: 1, // Lower priority → evaluated first
      conditions: [{ field: "cart_total", operator: "gte", value: 300 }],
      action: { type: "offer_discount", params: { percent: 30 } }
    }
  ];

  const ctx: RuleMatchContext = {
    cartTotal: 350,
    shippingCost: 15,
    cartItemCount: 1,
    skusInCart: ["SKU-001"],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate(rules, ctx);
  assert.equal(result.rule?.id, "rule-1", "Lower priority should match first");
  assert.equal(result.action?.params.percent, 30);
});

test("AdvancedRuleEvaluator — first-match-wins", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rules: AdvancedRule[] = [
    {
      id: "rule-1",
      enabled: true,
      priority: 1,
      conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      action: { type: "offer_discount", params: { percent: 10 } }
    },
    {
      id: "rule-2",
      enabled: true,
      priority: 1, // Same priority
      conditions: [{ field: "cart_total", operator: "gte", value: 200 }],
      action: { type: "offer_discount", params: { percent: 20 } }
    }
  ];

  const ctx: RuleMatchContext = {
    cartTotal: 250,
    shippingCost: 15,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate(rules, ctx);
  assert.equal(result.rule?.id, "rule-1", "First matching rule should win");
});

test("AdvancedRuleEvaluator — only enabled rules", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rules: AdvancedRule[] = [
    {
      id: "rule-disabled",
      enabled: false,
      priority: 1,
      conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      action: { type: "offer_discount", params: { percent: 50 } }
    },
    {
      id: "rule-enabled",
      enabled: true,
      priority: 2,
      conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      action: { type: "offer_discount", params: { percent: 10 } }
    }
  ];

  const ctx: RuleMatchContext = {
    cartTotal: 150,
    shippingCost: 15,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate(rules, ctx);
  assert.equal(result.rule?.id, "rule-enabled", "Disabled rule should be skipped");
});

test("AdvancedRuleEvaluator — numeric operators (gt, lt, gte, lte)", async () => {
  const evaluator = new AdvancedRuleEvaluator();

  const baseCtx: RuleMatchContext = {
    cartTotal: 250,
    shippingCost: 20,
    cartItemCount: 2,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  // gt
  let rule: AdvancedRule = {
    enabled: true,
    priority: 1,
    conditions: [{ field: "cart_total", operator: "gt", value: 200 }],
    action: { type: "offer_discount", params: {} }
  };
  assert.equal(evaluator.evaluate([rule], baseCtx).matched, true);

  rule.conditions = [{ field: "cart_total", operator: "gt", value: 250 }];
  assert.equal(evaluator.evaluate([rule], baseCtx).matched, false);

  // lt
  rule.conditions = [{ field: "cart_total", operator: "lt", value: 300 }];
  assert.equal(evaluator.evaluate([rule], baseCtx).matched, true);

  rule.conditions = [{ field: "cart_total", operator: "lt", value: 250 }];
  assert.equal(evaluator.evaluate([rule], baseCtx).matched, false);

  // gte
  rule.conditions = [{ field: "cart_total", operator: "gte", value: 250 }];
  assert.equal(evaluator.evaluate([rule], baseCtx).matched, true);

  // lte
  rule.conditions = [{ field: "cart_total", operator: "lte", value: 250 }];
  assert.equal(evaluator.evaluate([rule], baseCtx).matched, true);
});

test("AdvancedRuleEvaluator — contains operator (arrays)", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    enabled: true,
    priority: 1,
    conditions: [{ field: "category_in_cart", operator: "contains", value: "eletronicos" }],
    action: { type: "offer_discount", params: {} }
  };

  const ctx: RuleMatchContext = {
    cartTotal: 100,
    shippingCost: 10,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: ["eletronicos", "acessorios"],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  assert.equal(evaluator.evaluate([rule], ctx).matched, true);

  ctx.categoriesInCart = ["acessorios"];
  assert.equal(evaluator.evaluate([rule], ctx).matched, false);
});

test("AdvancedRuleEvaluator — is operator (strings)", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    enabled: true,
    priority: 1,
    conditions: [{ field: "buyer_type", operator: "is", value: "price_sensitive" }],
    action: { type: "offer_discount", params: {} }
  };

  const ctx: RuleMatchContext = {
    cartTotal: 100,
    shippingCost: 10,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  assert.equal(evaluator.evaluate([rule], ctx).matched, true);

  ctx.buyerType = "quality_seeker";
  assert.equal(evaluator.evaluate([rule], ctx).matched, false);
});

test("AdvancedRuleEvaluator — eq operator", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    enabled: true,
    priority: 1,
    conditions: [{ field: "coupon_applied", operator: "eq", value: false }],
    action: { type: "offer_discount", params: {} }
  };

  const ctx: RuleMatchContext = {
    cartTotal: 100,
    shippingCost: 10,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  assert.equal(evaluator.evaluate([rule], ctx).matched, true);

  ctx.couponApplied = true;
  assert.equal(evaluator.evaluate([rule], ctx).matched, false);
});

test("AdvancedRuleEvaluator — no rules", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const ctx: RuleMatchContext = {
    cartTotal: 100,
    shippingCost: 10,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate([], ctx);
  assert.equal(result.matched, false);
});

test("AdvancedRuleEvaluator — unknown field", async () => {
  const evaluator = new AdvancedRuleEvaluator();
  const rule: AdvancedRule = {
    enabled: true,
    priority: 1,
    conditions: [{ field: "unknown_field", operator: "eq", value: "test" }],
    action: { type: "offer_discount", params: {} }
  };

  const ctx: RuleMatchContext = {
    cartTotal: 100,
    shippingCost: 10,
    cartItemCount: 1,
    skusInCart: [],
    categoriesInCart: [],
    couponApplied: false,
    buyerType: "price_sensitive"
  };

  const result = evaluator.evaluate([rule], ctx);
  assert.equal(result.matched, false);
});

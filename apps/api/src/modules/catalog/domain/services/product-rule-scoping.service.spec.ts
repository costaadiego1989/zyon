import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AdvancedRule,
  RuleCondition,
  RuleAction,
} from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import {
  scopeRulesToProduct,
  mergeProductRules,
} from "./product-rule-scoping.service.js";

function makeRule(
  overrides: Partial<AdvancedRule> = {}
): AdvancedRule {
  return {
    id: "rule_1",
    enabled: true,
    priority: 1,
    conditions: [],
    action: { type: "offer_discount", params: { discountPercent: 10 } },
    ...overrides,
  };
}

describe("ProductRuleScopingService", () => {
  describe("scopeRulesToProduct", () => {
    it("should inject product_in_cart condition when absent", () => {
      const rule = makeRule({
        conditions: [
          {
            field: "cart_total",
            operator: "gte",
            value: 100,
          },
        ],
      });
      const skus = ["SKU-001"];

      const scoped = scopeRulesToProduct([rule], skus);

      assert.strictEqual(scoped.length, 1);
      assert.strictEqual(scoped[0].conditions.length, 2);

      const productCondition = scoped[0].conditions.find(
        (c) => c.field === "product_in_cart"
      );
      assert.ok(productCondition, "product_in_cart condition should exist");
      assert.strictEqual(productCondition.operator, "contains");
      assert.strictEqual(productCondition.value, "SKU-001");

      // cart_total preserved
      const cartCondition = scoped[0].conditions.find(
        (c) => c.field === "cart_total"
      );
      assert.ok(cartCondition, "cart_total condition should be preserved");
      assert.strictEqual(cartCondition.operator, "gte");
      assert.strictEqual(cartCondition.value, 100);

      // action preserved
      assert.deepStrictEqual(scoped[0].action, {
        type: "offer_discount",
        params: { discountPercent: 10 },
      });
    });

    it("should replace product_in_cart condition when present", () => {
      const rule = makeRule({
        conditions: [
          {
            field: "product_in_cart",
            operator: "contains",
            value: "OLD-SKU",
          },
          {
            field: "cart_item_count",
            operator: "gte",
            value: 2,
          },
        ],
      });
      const skus = ["SKU-NEW-001", "SKU-NEW-002"];

      const scoped = scopeRulesToProduct([rule], skus);

      assert.strictEqual(scoped.length, 1);
      assert.strictEqual(scoped[0].conditions.length, 2);

      // Should have product_in_cart with first SKU (single value limitation)
      const productCondition = scoped[0].conditions.find(
        (c) => c.field === "product_in_cart"
      );
      assert.ok(productCondition);
      assert.strictEqual(productCondition.value, "SKU-NEW-001");

      // cart_item_count preserved
      const cartItemCondition = scoped[0].conditions.find(
        (c) => c.field === "cart_item_count"
      );
      assert.ok(cartItemCondition);
      assert.strictEqual(cartItemCondition.operator, "gte");
      assert.strictEqual(cartItemCondition.value, 2);

      // OLD-SKU should be gone
      assert.strictEqual(
        scoped[0].conditions.filter((c) => c.value === "OLD-SKU").length,
        0
      );
    });

    it("should preserve all other conditions and action untouched", () => {
      const rule = makeRule({
        id: "rule_preserve",
        priority: 5,
        enabled: false,
        conditions: [
          { field: "buyer_type", operator: "eq", value: "returning" },
          { field: "coupon_applied", operator: "eq", value: true },
        ],
        action: {
          type: "offer_free_shipping",
          params: { shippingSubsidy: 50 },
        },
      });
      const skus = ["SKU-PRESERVE"];

      const scoped = scopeRulesToProduct([rule], skus);

      assert.strictEqual(scoped[0].id, "rule_preserve");
      assert.strictEqual(scoped[0].priority, 5);
      assert.strictEqual(scoped[0].enabled, false);

      // Original conditions preserved
      const buyerCondition = scoped[0].conditions.find(
        (c) => c.field === "buyer_type"
      );
      assert.ok(buyerCondition);
      assert.strictEqual(buyerCondition.value, "returning");

      const couponCondition = scoped[0].conditions.find(
        (c) => c.field === "coupon_applied"
      );
      assert.ok(couponCondition);

      // Action preserved
      assert.deepStrictEqual(scoped[0].action, {
        type: "offer_free_shipping",
        params: { shippingSubsidy: 50 },
      });
    });

    it("should handle rule with multiple SKUs (scopes to first SKU)", () => {
      const rule = makeRule({
        conditions: [
          { field: "cart_total", operator: "gt", value: 50 },
        ],
      });
      const skus = ["SKU-A", "SKU-B", "SKU-C"];

      const scoped = scopeRulesToProduct([rule], skus);

      const productCondition = scoped[0].conditions.find(
        (c) => c.field === "product_in_cart"
      );
      assert.ok(productCondition);
      // SPEC_DEVIATION: only first SKU is scoped (limitation of evaluator design)
      assert.strictEqual(productCondition.value, "SKU-A");
    });

    it("should handle empty rules array", () => {
      const scoped = scopeRulesToProduct([], ["SKU-001"]);
      assert.strictEqual(scoped.length, 0);
    });

    it("should handle rule with no conditions", () => {
      const rule = makeRule({ conditions: [] });
      const scoped = scopeRulesToProduct([rule], ["SKU-001"]);

      assert.strictEqual(scoped[0].conditions.length, 1);
      const productCondition = scoped[0].conditions[0];
      assert.strictEqual(productCondition.field, "product_in_cart");
      assert.strictEqual(productCondition.value, "SKU-001");
    });

    it("should process multiple rules independently", () => {
      const rule1 = makeRule({
        id: "rule_1",
        conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
      });
      const rule2 = makeRule({
        id: "rule_2",
        conditions: [{ field: "buyer_type", operator: "eq", value: "new" }],
      });
      const skus = ["SKU-001"];

      const scoped = scopeRulesToProduct([rule1, rule2], skus);

      assert.strictEqual(scoped.length, 2);
      assert.strictEqual(scoped[0].id, "rule_1");
      assert.strictEqual(scoped[1].id, "rule_2");

      // Both have product_in_cart injected
      assert.ok(
        scoped[0].conditions.find((c) => c.field === "product_in_cart")
      );
      assert.ok(
        scoped[1].conditions.find((c) => c.field === "product_in_cart")
      );
    });
  });

  describe("mergeProductRules", () => {
    it("should replace rule by id when it exists in existing", () => {
      const existing: AdvancedRule[] = [
        makeRule({
          id: "rule_1",
          conditions: [{ field: "cart_total", operator: "gte", value: 50 }],
        }),
      ];

      const productScoped: AdvancedRule[] = [
        makeRule({
          id: "rule_1",
          conditions: [
            { field: "cart_total", operator: "gte", value: 50 },
            { field: "product_in_cart", operator: "contains", value: "SKU-001" },
          ],
        }),
      ];

      const merged = mergeProductRules(existing, productScoped);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].id, "rule_1");
      assert.strictEqual(merged[0].conditions.length, 2); // Updated version
    });

    it("should append new rules without id", () => {
      const existing: AdvancedRule[] = [
        makeRule({ id: "rule_1" }),
      ];

      const productScoped: AdvancedRule[] = [
        makeRule({
          id: undefined,
          conditions: [
            { field: "product_in_cart", operator: "contains", value: "SKU-NEW" },
          ],
        }),
      ];

      const merged = mergeProductRules(existing, productScoped);

      assert.strictEqual(merged.length, 2);
      assert.strictEqual(merged[0].id, "rule_1");
      assert.strictEqual(merged[1].id, undefined);
    });

    it("should preserve existing rules not in productScoped", () => {
      const existing: AdvancedRule[] = [
        makeRule({ id: "rule_1" }),
        makeRule({ id: "rule_2" }),
        makeRule({ id: "rule_3" }),
      ];

      const productScoped: AdvancedRule[] = [
        makeRule({
          id: "rule_2",
          conditions: [
            { field: "product_in_cart", operator: "contains", value: "SKU-001" },
          ],
        }),
      ];

      const merged = mergeProductRules(existing, productScoped);

      assert.strictEqual(merged.length, 3);
      assert.deepStrictEqual(
        merged.map((r) => r.id),
        ["rule_1", "rule_2", "rule_3"]
      );

      // rule_2 is updated, others unchanged
      const updatedRule2 = merged.find((r) => r.id === "rule_2");
      assert.ok(
        updatedRule2.conditions.find((c) => c.field === "product_in_cart")
      );
    });

    it("should append productScoped rules with new ids", () => {
      const existing: AdvancedRule[] = [
        makeRule({ id: "rule_1" }),
      ];

      const productScoped: AdvancedRule[] = [
        makeRule({
          id: "rule_new_1",
          conditions: [
            { field: "product_in_cart", operator: "contains", value: "SKU-001" },
          ],
        }),
        makeRule({
          id: "rule_new_2",
          conditions: [
            { field: "product_in_cart", operator: "contains", value: "SKU-002" },
          ],
        }),
      ];

      const merged = mergeProductRules(existing, productScoped);

      assert.strictEqual(merged.length, 3);
      assert.strictEqual(merged[0].id, "rule_1");
      assert.strictEqual(merged[1].id, "rule_new_1");
      assert.strictEqual(merged[2].id, "rule_new_2");
    });

    it("should handle empty existing rules", () => {
      const productScoped: AdvancedRule[] = [
        makeRule({ id: "rule_new" }),
      ];

      const merged = mergeProductRules([], productScoped);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].id, "rule_new");
    });

    it("should handle empty productScoped rules", () => {
      const existing: AdvancedRule[] = [
        makeRule({ id: "rule_1" }),
      ];

      const merged = mergeProductRules(existing, []);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].id, "rule_1");
    });

    it("should preserve order: existing first, then appended new rules", () => {
      const existing: AdvancedRule[] = [
        makeRule({ id: "rule_1", priority: 10 }),
        makeRule({ id: "rule_2", priority: 20 }),
      ];

      const productScoped: AdvancedRule[] = [
        makeRule({
          id: "rule_new_1",
          priority: 5,
          conditions: [
            { field: "product_in_cart", operator: "contains", value: "SKU-001" },
          ],
        }),
      ];

      const merged = mergeProductRules(existing, productScoped);

      assert.strictEqual(merged.length, 3);
      assert.strictEqual(merged[0].id, "rule_1");
      assert.strictEqual(merged[1].id, "rule_2");
      assert.strictEqual(merged[2].id, "rule_new_1");
    });

    it("should handle mixed: replacement + preservation + append", () => {
      const existing: AdvancedRule[] = [
        makeRule({
          id: "rule_1",
          conditions: [{ field: "cart_total", operator: "gte", value: 100 }],
        }),
        makeRule({
          id: "rule_2",
          conditions: [{ field: "buyer_type", operator: "eq", value: "new" }],
        }),
        makeRule({
          id: "rule_3",
          conditions: [{ field: "coupon_applied", operator: "eq", value: true }],
        }),
      ];

      const productScoped: AdvancedRule[] = [
        makeRule({
          id: "rule_2",
          conditions: [
            { field: "buyer_type", operator: "eq", value: "new" },
            { field: "product_in_cart", operator: "contains", value: "SKU-X" },
          ],
        }),
        makeRule({
          id: "rule_new",
          conditions: [
            { field: "product_in_cart", operator: "contains", value: "SKU-Y" },
          ],
        }),
      ];

      const merged = mergeProductRules(existing, productScoped);

      assert.strictEqual(merged.length, 4);
      assert.strictEqual(merged[0].id, "rule_1"); // Preserved
      assert.strictEqual(merged[1].id, "rule_2"); // Replaced
      assert.strictEqual(merged[2].id, "rule_3"); // Preserved
      assert.strictEqual(merged[3].id, "rule_new"); // Appended

      // rule_1 and rule_3 have original conditions
      assert.strictEqual(merged[0].conditions.length, 1);
      assert.strictEqual(merged[2].conditions.length, 1);

      // rule_2 is updated
      assert.strictEqual(merged[1].conditions.length, 2);
      assert.ok(
        merged[1].conditions.find((c) => c.field === "product_in_cart")
      );
    });
  });
});

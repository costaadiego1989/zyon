/**
 * Product-scoped advanced rule injection service (pure domain).
 *
 * When a merchant builds advanced rules from the PRODUCT form, each rule must be
 * auto-scoped to that product's SKUs so the existing cart engine only applies it
 * when that product is in the cart. Then merged into the merchant's existing
 * advancedRules array WITHOUT clobbering unrelated rules.
 *
 * SPEC_DEVIATION: product_in_cart condition uses single SKU only.
 * The evaluator's product_in_cart condition expects a single SKU value with "contains" operator
 * (checking if skusInCart array includes that value). To scope to multiple SKUs, we inject
 * ONE condition scoped to the FIRST SKU only. This means a rule will match when ANY of the
 * product's SKUs are in cart (since evaluator checks includes(value)), but if you need to
 * require ALL SKUs to be present, that would require either:
 *  - Multiple product_in_cart conditions (ANDed together), which would require all SKUs
 *  - A modified evaluator that supports OR logic or array values
 * For now, we preserve first-SKU scoping for simplicity and correctness with the evaluator.
 */

import type {
  AdvancedRule,
  RuleCondition,
} from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";

/**
 * Scope rules to a product by injecting product_in_cart conditions.
 *
 * For each rule:
 *  - If it has NO product_in_cart condition → inject one scoped to the product's FIRST SKU
 *  - If it HAS a product_in_cart condition → replace it with first SKU of this product
 *  - All other conditions and action are preserved untouched
 *
 * @param rules Array of AdvancedRule to scope
 * @param productSkus Array of SKUs for this product
 * @returns Array of rules with product_in_cart conditions scoped to first SKU
 */
export function scopeRulesToProduct(
  rules: AdvancedRule[],
  productSkus: string[]
): AdvancedRule[] {
  if (!rules || rules.length === 0) {
    return [];
  }

  if (!productSkus || productSkus.length === 0) {
    // No SKUs to scope to — return rules unchanged
    return rules.map((r) => ({ ...r }));
  }

  const firstSku = productSkus[0];

  return rules.map((rule) => {
    // Find existing product_in_cart condition
    const existingProductConditionIndex = rule.conditions.findIndex(
      (c: RuleCondition) => c.field === "product_in_cart"
    );

    let newConditions: RuleCondition[];

    if (existingProductConditionIndex >= 0) {
      // Replace existing product_in_cart condition
      newConditions = rule.conditions.map((c: RuleCondition, i: number) => {
        if (i === existingProductConditionIndex) {
          return {
            field: "product_in_cart",
            operator: "contains",
            value: firstSku,
          };
        }
        return c;
      });
    } else {
      // Inject new product_in_cart condition
      const productCondition: RuleCondition = {
        field: "product_in_cart",
        operator: "contains",
        value: firstSku,
      };
      newConditions = [...rule.conditions, productCondition];
    }

    return {
      ...rule,
      conditions: newConditions,
    };
  });
}

/**
 * Merge product-scoped rules into existing rules.
 *
 * Strategy:
 *  - Rules in productScoped WITH an id that exists in existing → replace that entry
 *  - Rules in productScoped WITHOUT an id or with new id → append
 *  - Rules in existing NOT referenced by productScoped → preserve untouched
 *
 * @param existing Merchant's current advanced rules
 * @param productScoped Rules scoped to this product
 * @returns Merged array: existing (updated where needed) + new appended
 */
export function mergeProductRules(
  existing: AdvancedRule[],
  productScoped: AdvancedRule[]
): AdvancedRule[] {
  // Build a map of productScoped rules by id for quick lookup
  const scopedById = new Map<string, AdvancedRule>();
  const newRules: AdvancedRule[] = [];

  for (const rule of productScoped) {
    if (rule.id) {
      scopedById.set(rule.id, rule);
    } else {
      newRules.push(rule);
    }
  }

  // Start with existing rules, updating any that are in scopedById
  const result = existing.map((rule) => {
    if (rule.id && scopedById.has(rule.id)) {
      return scopedById.get(rule.id)!;
    }
    return rule;
  });

  // Append productScoped rules that were not replacements (new ids or no id)
  for (const rule of productScoped) {
    if (!rule.id) {
      result.push(rule);
    } else if (!existing.find((e) => e.id === rule.id)) {
      result.push(rule);
    }
  }

  return result;
}

/**
 * Product-scoped advanced rule injection service (pure domain).
 *
 * When a merchant builds advanced rules from the PRODUCT form, each rule must be
 * auto-scoped to that product's SKUs so the existing cart engine only applies it
 * when that product is in the cart. Then merged into the merchant's existing
 * advancedRules array WITHOUT clobbering unrelated rules.
 *
 * A product with several active variations is scoped with an array of its
 * active SKUs. The evaluator interprets `contains` arrays as ANY-of, while
 * preserving AND semantics between this and every other rule condition.
 */

import type {
  AdvancedRule,
  RuleCondition,
} from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";

/**
 * Scope rules to a product by injecting product_in_cart conditions.
 *
 * For each rule:
 *  - If it has NO product_in_cart condition → inject one scoped to all active SKUs
 *  - If it HAS a product_in_cart condition → replace it with the product's active SKUs
 *  - All other conditions and action are preserved untouched
 *
 * @param rules Array of AdvancedRule to scope
 * @param productSkus Array of SKUs for this product
 * @returns Array of rules with product_in_cart conditions scoped to active SKUs
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

  const scopedValue = productSkus.length === 1 ? productSkus[0] : [...productSkus];

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
            value: scopedValue,
          };
        }
        return c;
      });
    } else {
      // Inject new product_in_cart condition
      const productCondition: RuleCondition = {
        field: "product_in_cart",
        operator: "contains",
        value: scopedValue,
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

/**
 * Deterministic rule evaluator for AdvancedRules matching against cart/session context.
 * Pure domain service: no NestJS, no I/O.
 *
 * INVARIANT: Must only evaluate enabled rules, respecting priority order (ascending).
 * First-match-wins. No side effects.
 */

export interface RuleMatchContext {
  cartTotal: number;
  shippingCost: number;
  cartItemCount: number;
  skusInCart: string[];
  categoriesInCart: string[];
  couponApplied: boolean;
  buyerType: string; // primary_intent OR new/returning
  paymentMethod?: string;
  triggerFired?: string;
}

export interface RuleCondition {
  field: string; // cart_total, shipping_cost, cart_item_count, product_in_cart, category_in_cart, coupon_applied, buyer_type, payment_method, trigger_fired
  operator: string; // gt, lt, gte, lte, eq, contains, is
  value: string | number | boolean;
}

export interface RuleAction {
  type: string; // offer_discount, offer_free_shipping, offer_coupon, show_message, suggest_product, do_nothing, offer_installments
  params: Record<string, string | number | boolean>;
}

export interface AdvancedRule {
  id?: string;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  action: RuleAction;
}

export interface RuleMatchResult {
  matched: boolean;
  rule?: AdvancedRule;
  action?: RuleAction;
}

export class AdvancedRuleEvaluator {
  /**
   * Evaluate rules against context. AND logic between conditions.
   * Rules sorted by priority ascending (lower number wins).
   * First match returns immediately.
   * @param rules Array of AdvancedRule
   * @param ctx RuleMatchContext (cart, shipping, buyer, etc.)
   * @returns RuleMatchResult — matched:true + rule + action, OR matched:false + no rule
   */
  evaluate(rules: AdvancedRule[], ctx: RuleMatchContext): RuleMatchResult {
    if (!rules || rules.length === 0) {
      return { matched: false };
    }

    // Filter enabled rules and sort by priority (ascending = lower number first)
    const enabledRules = rules.filter(r => r.enabled).sort((a, b) => a.priority - b.priority);

    for (const rule of enabledRules) {
      // AND logic: all conditions must match
      const allMatch = rule.conditions.every(cond => this.matchCondition(cond, ctx));
      if (allMatch) {
        return {
          matched: true,
          rule,
          action: rule.action
        };
      }
    }

    return { matched: false };
  }

  /**
   * Evaluate a single condition against context.
   * Operators: gt, lt, gte, lte, eq, contains, is
   */
  private matchCondition(condition: RuleCondition, ctx: RuleMatchContext): boolean {
    const { field, operator, value } = condition;

    // Map fields to context values
    let contextValue: any;
    switch (field) {
      case "cart_total":
        contextValue = ctx.cartTotal;
        break;
      case "shipping_cost":
        contextValue = ctx.shippingCost;
        break;
      case "cart_item_count":
        contextValue = ctx.cartItemCount;
        break;
      case "product_in_cart":
        contextValue = ctx.skusInCart;
        break;
      case "category_in_cart":
        contextValue = ctx.categoriesInCart;
        break;
      case "coupon_applied":
        contextValue = ctx.couponApplied;
        break;
      case "buyer_type":
        contextValue = ctx.buyerType;
        break;
      case "payment_method":
        contextValue = ctx.paymentMethod ?? null;
        break;
      case "trigger_fired":
        contextValue = ctx.triggerFired ?? null;
        break;
      default:
        return false; // Unknown field → no match
    }

    // Evaluate operator
    switch (operator.toLowerCase()) {
      case "gt":
        return typeof contextValue === "number" && contextValue > (value as number);
      case "lt":
        return typeof contextValue === "number" && contextValue < (value as number);
      case "gte":
        return typeof contextValue === "number" && contextValue >= (value as number);
      case "lte":
        return typeof contextValue === "number" && contextValue <= (value as number);
      case "eq":
        return contextValue === value;
      case "contains":
        // For arrays (product_in_cart, category_in_cart)
        return Array.isArray(contextValue) && contextValue.includes(String(value));
      case "is":
        return String(contextValue) === String(value);
      default:
        return false; // Unknown operator → no match
    }
  }

  /**
   * Check if a rule WOULD match without actually evaluating (for benefit availability check).
   * Used by buyer-hub to show available rules the buyer qualifies for.
   */
  wouldMatch(rule: AdvancedRule, ctx: RuleMatchContext): boolean {
    if (!rule.enabled) return false;
    return rule.conditions.every(cond => this.matchCondition(cond, ctx));
  }
}

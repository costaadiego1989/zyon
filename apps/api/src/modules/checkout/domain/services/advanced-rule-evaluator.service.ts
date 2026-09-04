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

/** Per-rule match detail from evaluateAll — used by the proximity engine. */
export interface RuleEvalDetail {
  rule: AdvancedRule;
  matched: boolean;
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
   * Evaluate EVERY enabled rule (not first-match) and report per-rule whether it
   * matched. Used by the proximity engine to compute "almost there" nudges for
   * the rules that did NOT match yet. Priority-sorted ascending, same as evaluate().
   */
  evaluateAll(rules: AdvancedRule[], ctx: RuleMatchContext): RuleEvalDetail[] {
    if (!rules || rules.length === 0) return [];
    return rules
      .filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map(rule => ({
        rule,
        matched: rule.conditions.every(cond => this.matchCondition(cond, ctx)),
      }));
  }

  /**
   * Public single-condition check — lets the proximity engine reason about how
   * close a single unmet condition is (e.g. cart_total gap) without duplicating
   * the operator-normalization logic.
   */
  checkCondition(condition: RuleCondition, ctx: RuleMatchContext): boolean {
    return this.matchCondition(condition, ctx);
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

    // Normalize operator: the dashboard RuleEditor emits symbolic operators
    // (>, <, >=, <=, ==) while seed/AI rules use word operators (gt, lt, gte,
    // lte, eq). Map both vocabularies to a single canonical form so a rule
    // authored in the UI actually matches at checkout instead of silently
    // falling through to the default (no-match) branch.
    const canonical = normalizeOperator(operator);

    // Numeric operators must compare numbers. The UI stores condition values as
    // strings ("250"), so coerce before comparing — otherwise 250 > "250" style
    // coercion yields wrong results.
    const numericValue = typeof value === "number" ? value : Number(value);

    switch (canonical) {
      case "gt":
        return typeof contextValue === "number" && contextValue > numericValue;
      case "lt":
        return typeof contextValue === "number" && contextValue < numericValue;
      case "gte":
        return typeof contextValue === "number" && contextValue >= numericValue;
      case "lte":
        return typeof contextValue === "number" && contextValue <= numericValue;
      case "eq":
        // Loose equality across string/number/boolean (UI stores strings).
        return String(contextValue) === String(value);
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

/**
 * Map both symbolic (dashboard UI) and word (seed/AI) operator vocabularies to
 * a single canonical form the evaluator switch understands. Without this, rules
 * authored in the dashboard (which emits >, <, >=, <=, ==) never matched at
 * checkout because the switch only handled gt/lt/gte/lte/eq.
 */
function normalizeOperator(operator: string): string {
  switch (operator.trim().toLowerCase()) {
    case ">":
    case "gt":
      return "gt";
    case "<":
    case "lt":
      return "lt";
    case ">=":
    case "gte":
      return "gte";
    case "<=":
    case "lte":
      return "lte";
    case "==":
    case "===":
    case "=":
    case "eq":
      return "eq";
    case "contains":
      return "contains";
    case "is":
      return "is";
    default:
      return operator.trim().toLowerCase();
  }
}

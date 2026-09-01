/**
 * Deterministic cart rules engine (storefront).
 *
 * The single place where advanced rules turn into a concrete discount / free
 * shipping decision for a storefront cart. Pure domain service: no NestJS, no
 * I/O. Runs on every cart mutation (add/remove/update qty) so the applied
 * discount is a deterministic FUNCTION of cart state — never something the LLM
 * decides.
 *
 * INVARIANTS (CLAUDE.md):
 * - LLM never authorizes offers — this service is the authority, called server-side.
 * - Discounts approved ONLY by the rules-engine (`evaluateDiscountOffer`), which
 *   hard-caps `maxDiscountPercent` and rejects below `minimumMarginPercent`.
 * - Offer math is deterministic + idempotent: same cart + rules → same result.
 *   Recomputed from scratch each call (never accumulates discount over discount).
 */

import type { Cart, MerchantRules } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import {
  AdvancedRuleEvaluator,
  type AdvancedRule,
  type RuleMatchContext,
} from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import type { StorefrontCart } from "../ports/storefront-cart.port.js";

export interface CartRulesResult {
  /** Discount to persist on the cart, in cents. 0 when no rule applies. */
  discountCents: number;
  /** True when a matched rule grants free shipping (subject to merchant allowFreeShipping). */
  freeShipping: boolean;
  /** Id of the winning rule (first match by priority), if any. */
  appliedRuleId?: string;
  /** Human-facing reason, e.g. "discount_allowed", "capped_by_max_discount_rule". */
  reason: string;
}

const NO_RESULT: CartRulesResult = { discountCents: 0, freeShipping: false, reason: "no_rule_matched" };

/**
 * Build the rule-match context from a storefront cart. Prices are converted from
 * cents (storefront cart) to reais (rules-engine / RuleMatchContext).
 */
export function buildCartRuleContext(
  cart: StorefrontCart,
  opts?: { buyerType?: string; paymentMethod?: string; couponApplied?: boolean; categoriesInCart?: string[] },
): RuleMatchContext {
  const cartTotalReais = (cart.total ?? 0) / 100;
  const cartItemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  return {
    cartTotal: cartTotalReais,
    shippingCost: 0,
    cartItemCount,
    skusInCart: cart.items.map((i) => i.sku ?? i.variantId),
    categoriesInCart: opts?.categoriesInCart ?? [],
    couponApplied: opts?.couponApplied ?? Boolean(cart.couponCode),
    buyerType: opts?.buyerType ?? "returning",
    paymentMethod: opts?.paymentMethod,
  };
}

export class CartRulesEngine {
  private readonly evaluator = new AdvancedRuleEvaluator();

  /**
   * Evaluate advanced rules against a cart and return the deterministic
   * discount / free-shipping decision. Discount always routed through the
   * rules-engine (`evaluateDiscountOffer`) for the hard cap + margin floor.
   */
  evaluate(
    cart: StorefrontCart,
    advancedRules: AdvancedRule[],
    merchantRules: MerchantRules,
    ctx: RuleMatchContext,
  ): CartRulesResult {
    if (!advancedRules || advancedRules.length === 0) return NO_RESULT;
    if ((cart.total ?? 0) <= 0) return NO_RESULT;

    const match = this.evaluator.evaluate(advancedRules, ctx);
    if (!match.matched || !match.action) return NO_RESULT;

    const action = match.action;
    const ruleId = match.rule?.id;

    switch (action.type) {
      case "offer_discount": {
        const requestedPercent = Number(action.params.percent) || 0;
        const maxReaisCap =
          action.params.maxDiscountReais != null ? Number(action.params.maxDiscountReais) : undefined;
        if (requestedPercent <= 0) return { ...NO_RESULT, appliedRuleId: ruleId };

        // Route through the rules-engine — hard cap + margin floor authority.
        const engineCart = toEngineCart(cart);
        const evaluation = evaluateDiscountOffer(engineCart, merchantRules, requestedPercent, maxReaisCap);
        if (!evaluation.approved || evaluation.value <= 0) {
          return { discountCents: 0, freeShipping: false, appliedRuleId: ruleId, reason: evaluation.reason };
        }
        // evaluation.value is an effective PERCENT — convert to a cents amount off the cart total.
        const discountCents = Math.round((cart.total ?? 0) * (evaluation.value / 100));
        return { discountCents, freeShipping: false, appliedRuleId: ruleId, reason: evaluation.reason };
      }

      case "offer_free_shipping": {
        // Free shipping only when the merchant allows it. Flag, not a hand-zeroed price.
        const freeShipping = merchantRules.allowFreeShipping !== false;
        return {
          discountCents: 0,
          freeShipping,
          appliedRuleId: ruleId,
          reason: freeShipping ? "free_shipping_allowed" : "free_shipping_disabled_by_merchant",
        };
      }

      // offer_coupon / show_message / suggest_product / offer_installments / do_nothing:
      // no direct cart-price effect here (handled elsewhere or informational only).
      default:
        return { ...NO_RESULT, appliedRuleId: ruleId };
    }
  }
}

/** Convert a storefront cart (cents) into the rules-engine Cart shape (reais). */
function toEngineCart(cart: StorefrontCart): Cart {
  return {
    currency: "BRL",
    items: cart.items.map((i) => ({
      sku: i.sku ?? i.variantId,
      name: i.name,
      price: i.unitPriceCents / 100,
      quantity: i.quantity,
    })),
    total: (cart.total ?? 0) / 100,
    currentDiscount: 0,
    source: "storefront",
  };
}

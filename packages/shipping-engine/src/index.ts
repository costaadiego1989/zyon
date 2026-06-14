import type { Cart, MerchantRules, ShippingQuote } from "@aacp/shared-types";
import { estimateMargin, type OfferEvaluation } from "@aacp/rules-engine";

export interface ShippingDecisionInput {
  cart: Cart;
  shipping?: ShippingQuote;
  rules: MerchantRules;
  abandonmentScore: number;
}

export function evaluateShippingOffer(input: ShippingDecisionInput): OfferEvaluation {
  const shippingCost = input.shipping?.realCost ?? input.shipping?.customerPrice ?? 0;
  const customerPrice = input.shipping?.customerPrice ?? shippingCost;
  const region = input.shipping?.region;

  if (!shippingCost || !customerPrice) {
    return blocked("shipping_quote_missing", input.cart, 0);
  }

  if (region && input.rules.blockedRegions.includes(region)) {
    return blocked("blocked_shipping_region", input.cart, 0);
  }

  if (input.abandonmentScore < 0.55) {
    return blocked("abandonment_score_too_low", input.cart, 0);
  }

  if (!input.rules.allowStackDiscountAndFreeShipping && (input.cart.currentDiscount ?? 0) > 0) {
    return blocked("stack_discount_and_free_shipping_not_allowed", input.cart, 0);
  }

  if (input.rules.allowFreeShipping && input.cart.total >= input.rules.freeShippingMinCartValue) {
    const freeShipping = evaluateSubsidy(input.cart, input.rules, shippingCost, "shipping_free");
    if (freeShipping.approved) {
      return freeShipping;
    }
  }

  if (input.rules.allowShippingDiscount) {
    const partial = Math.min(
      input.rules.maxPartialShippingDiscount,
      input.rules.maxShippingSubsidy,
      shippingCost
    );
    return evaluateSubsidy(input.cart, input.rules, partial, "shipping_discount_fixed");
  }

  return blocked("shipping_discount_not_allowed", input.cart, 0);
}

function evaluateSubsidy(
  cart: Cart,
  rules: MerchantRules,
  subsidy: number,
  type: "shipping_free" | "shipping_discount_fixed"
): OfferEvaluation {
  if (subsidy > rules.maxShippingSubsidy) {
    return blocked("shipping_subsidy_above_limit", cart, subsidy);
  }

  const margin = estimateMargin(cart, subsidy);
  if (margin.marginPercent < rules.minimumMarginPercent / 100) {
    return {
      approved: false,
      type: "none",
      value: 0,
      reason: "minimum_margin_violation",
      marginAfterOffer: margin.marginPercent
    };
  }

  return {
    approved: true,
    type,
    value: subsidy,
    reason: type === "shipping_free" ? "free_shipping_allowed" : "partial_shipping_allowed",
    marginAfterOffer: margin.marginPercent
  };
}

function blocked(reason: string, cart: Cart, subsidy: number): OfferEvaluation {
  return {
    approved: false,
    type: "none",
    value: 0,
    reason,
    marginAfterOffer: estimateMargin(cart, subsidy).marginPercent
  };
}

export { selectCheapestQuote } from "./select-cheapest-quote.js";
export type { CarrierQuoteInput } from "./select-cheapest-quote.js";

export {
  buildQuoteKey,
  computeQuoteExpiry,
  isQuoteExpired,
  DEFAULT_QUOTE_TTL_SECONDS
} from "./quote-key.js";
export type { QuoteKeyInput } from "./quote-key.js";

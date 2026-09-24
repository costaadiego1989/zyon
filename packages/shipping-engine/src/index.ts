import type { Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { assessIncentiveMargin, meetsMarginFloor, moneyCents, type OfferEvaluation } from "@zyon/rules-engine";

export { selectCheapestQuote } from "./select-cheapest-quote.js";
export type { CarrierQuoteInput } from "./select-cheapest-quote.js";
export { buildQuoteKey, computeQuoteExpiry, isQuoteExpired, DEFAULT_QUOTE_TTL_SECONDS } from "./quote-key.js";
export type { QuoteKeyInput } from "./quote-key.js";
export { validateCep, assertValidCep } from "./cep-validation.js";
export type { CepValidationResult } from "./cep-validation.js";
export { validatePackageDimensions, validatePackagesList, assertValidPackages, MELHOR_ENVIO_LIMITS } from "./package-dimensions.js";
export type { PackageValidationResult, PackageListValidationResult } from "./package-dimensions.js";

export interface ShippingDecisionInput {
  cart: Cart;
  shipping?: ShippingQuote;
  rules: MerchantRules;
  abandonmentScore: number;
}

const blocked = (reason: string, marginAfterOffer = 0): OfferEvaluation => ({
  approved: false, type: "none", value: 0, reason, marginAfterOffer,
});

/** Shared authority for coupons and contextual shipping offers. A coupon's
 * face value cannot bypass carrier cost, stacking, region or subsidy limits. */
export function authorizeShippingDiscount(input: Omit<ShippingDecisionInput, "abandonmentScore"> & {
  requestedDiscount: number;
  type: "shipping_free" | "shipping_discount_fixed";
}): OfferEvaluation {
  const { cart, rules, shipping, type } = input;
  if (cart.currency !== "BRL") return blocked("incentive_currency_unsupported");
  const realCost = moneyCents(shipping?.realCost);
  const customerPrice = moneyCents(shipping?.customerPrice);
  const discount = moneyCents(input.requestedDiscount);
  if (realCost === null || customerPrice === null || customerPrice <= 0) return blocked("shipping_quote_missing");
  if (discount === null || discount <= 0 || discount > customerPrice) return blocked("shipping_discount_invalid");
  const maxSubsidy = moneyCents(rules.maxShippingSubsidy);
  const maxPartial = moneyCents(rules.maxPartialShippingDiscount);
  const freeMinimum = moneyCents(rules.freeShippingMinCartValue);
  if (maxSubsidy === null || maxPartial === null || freeMinimum === null ||
      !Number.isFinite(rules.minimumMarginPercent) || rules.minimumMarginPercent < 0 || rules.minimumMarginPercent > 100) {
    return blocked("economic_input_invalid");
  }
  if (rules.blockedRegions.length && !shipping?.region) return blocked("shipping_region_missing");
  if (shipping?.region && rules.blockedRegions.includes(shipping.region)) return blocked("blocked_shipping_region");
  if (!rules.allowStackDiscountAndFreeShipping && (cart.currentDiscount ?? 0) > 0) return blocked("stack_discount_and_free_shipping_not_allowed");
  const cartTotal = moneyCents(cart.total);
  const existingDiscount = moneyCents(cart.currentDiscount ?? 0);
  if (cartTotal === null || existingDiscount === null || !Number.isFinite(rules.maxDiscountPercent) ||
      rules.maxDiscountPercent < 0 || rules.maxDiscountPercent > 100) return blocked("economic_input_invalid");
  if (existingDiscount > Math.floor(Number((cartTotal * rules.maxDiscountPercent / 100).toFixed(6)))) {
    return blocked("existing_discount_above_limit");
  }
  if (type === "shipping_free") {
    if (!rules.allowFreeShipping) return blocked("free_shipping_not_allowed");
    if (discount !== customerPrice || cart.total * 100 < freeMinimum) return blocked("free_shipping_minimum_not_met");
  } else {
    if (!rules.allowShippingDiscount) return blocked("shipping_discount_not_allowed");
    if (discount > maxPartial) return blocked("shipping_partial_discount_above_limit");
  }
  // A 100%/fixed shipping coupon is also a full waiver; its label cannot bypass
  // the merchant's free-shipping eligibility.
  if (discount === customerPrice) {
    if (!rules.allowFreeShipping) return blocked("free_shipping_not_allowed");
    if (cart.total * 100 < freeMinimum) return blocked("free_shipping_minimum_not_met");
  }
  const afterShippingRevenue = customerPrice - discount;
  // Protect both the advertised incentive and the merchant's full carrier shortfall.
  if (Math.max(discount, realCost - afterShippingRevenue) > maxSubsidy) return blocked("shipping_subsidy_above_limit");
  const margin = assessIncentiveMargin(cart, {
    totalDiscount: cart.currentDiscount ?? 0,
    shippingRevenue: afterShippingRevenue / 100, shippingCost: realCost / 100,
  });
  if (margin.status === "unavailable") return blocked(margin.reason);
  if (!meetsMarginFloor(margin, rules.minimumMarginPercent)) return blocked("minimum_margin_violation", margin.marginPercent ?? 0);
  return { approved: true, type, value: discount / 100,
    reason: type === "shipping_free" ? "free_shipping_allowed" : "partial_shipping_allowed",
    marginAfterOffer: margin.marginPercent! };
}

export function evaluateShippingOffer(input: ShippingDecisionInput): OfferEvaluation {
  if (!Number.isFinite(input.abandonmentScore) || input.abandonmentScore < 0.55 || input.abandonmentScore > 1) {
    return blocked("abandonment_score_too_low");
  }
  const customerPrice = moneyCents(input.shipping?.customerPrice);
  if (moneyCents(input.shipping?.realCost) === null || customerPrice === null || customerPrice <= 0) return blocked("shipping_quote_missing");
  if (input.rules.allowFreeShipping && input.cart.total >= input.rules.freeShippingMinCartValue) {
    const free = authorizeShippingDiscount({ ...input, requestedDiscount: customerPrice / 100, type: "shipping_free" });
    if (free.approved || !input.rules.allowShippingDiscount) return free;
  }
  return authorizeShippingDiscount({ ...input,
    requestedDiscount: Math.min(input.rules.maxPartialShippingDiscount, input.rules.maxShippingSubsidy, customerPrice / 100),
    type: "shipping_discount_fixed" });
}

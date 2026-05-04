import type { Cart, MerchantRules, OfferType } from "@aacp/shared-types";

export interface MarginResult {
  grossRevenue: number;
  productCost: number;
  paymentFees: number;
  subsidy: number;
  marginValue: number;
  marginPercent: number;
}

export interface OfferEvaluation {
  approved: boolean;
  type: OfferType;
  value: number;
  reason: string;
  marginAfterOffer: number;
}

export function estimateMargin(
  cart: Cart,
  subsidy = 0,
  paymentFeeRate = 0.04
): MarginResult {
  const productCost = cart.items.reduce(
    (sum, item) => sum + (item.cost ?? item.price * 0.5) * item.quantity,
    0
  );
  const grossRevenue = Math.max(cart.total - subsidy, 0);
  const paymentFees = grossRevenue * paymentFeeRate;
  const marginValue = grossRevenue - productCost - paymentFees;
  const marginPercent = grossRevenue > 0 ? marginValue / grossRevenue : 0;

  return { grossRevenue, productCost, paymentFees, subsidy, marginValue, marginPercent };
}

export function evaluateDiscountOffer(
  cart: Cart,
  rules: MerchantRules,
  requestedPercent: number
): OfferEvaluation {
  const percent = Math.min(requestedPercent, rules.maxDiscountPercent);
  const subsidy = cart.total * (percent / 100);
  const margin = estimateMargin(cart, subsidy);

  if (percent <= 0) {
    return {
      approved: false,
      type: "none",
      value: 0,
      reason: "discount_not_requested",
      marginAfterOffer: margin.marginPercent
    };
  }

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
    type: "discount_percent",
    value: percent,
    reason: percent < requestedPercent ? "capped_by_max_discount_rule" : "discount_allowed",
    marginAfterOffer: margin.marginPercent
  };
}

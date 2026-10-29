import type { Cart, MerchantRules, OfferType } from "@zyon/shared-types";
import { assessIncentiveMargin, cartAmountIssue, moneyCents } from "./incentive-margin.js";
import { evaluateCombinedDiscount, floorDiscountPercentageCents } from "./combined-discount.js";
export * from "./incentive-margin.js";
export * from "./contribution.js";
export { evaluateCombinedDiscount, type CombinedDiscountDecision } from "./combined-discount.js";

export interface MarginResult {
  grossRevenue: number | null;
  productCost: number | null;
  paymentFees: number | null;
  subsidy: number;
  marginValue: number | null;
  marginPercent: number | null;
  status: "estimated" | "unavailable";
  reason: string;
}

export interface OfferEvaluation {
  approved: boolean;
  type: OfferType;
  value: number;
  reason: string;
  /** Legacy informational field; zero when unavailable is not measured margin.
   * Never participates in commercial authorization. */
  marginAfterOffer: number;
}

export function estimateMargin(cart: Cart, subsidy = 0, paymentFeeRate = 0.04): MarginResult {
  const margin = assessIncentiveMargin(cart, { totalDiscount: subsidy, paymentFeeRate });
  const major = (cents: number | null) => cents === null ? null : cents / 100;
  return { grossRevenue: major(margin.revenueCents), productCost: major(margin.productCostCents),
    paymentFees: major(margin.paymentFeesCents), subsidy, marginValue: major(margin.marginCents),
    marginPercent: margin.marginPercent, status: margin.status, reason: margin.reason };
}

export function evaluateDiscountOffer(
  cart: Cart, rules: Pick<MerchantRules, "maxDiscountPercent"> & Partial<MerchantRules>, requestedPercent: number, maxReaisCap?: number,
): OfferEvaluation {
  const blocked = (reason: string, marginAfterOffer = 0): OfferEvaluation => ({
    approved: false, type: "none", value: 0, reason, marginAfterOffer,
  });
  const amountIssue = cartAmountIssue(cart);
  if (amountIssue) return blocked(amountIssue);
  if (cart.discountBudget !== undefined) {
    if (cart.currency !== "BRL") return blocked("incentive_currency_unsupported");
    const subtotal = moneyCents(cart.total);
    const fixedCap = maxReaisCap === undefined ? undefined : moneyCents(maxReaisCap);
    if (subtotal === null || !Number.isFinite(requestedPercent) || fixedCap === null) return blocked("economic_input_invalid");
    if (requestedPercent <= 0 || subtotal <= 0) return blocked("discount_not_requested");
    const requested = floorDiscountPercentageCents(subtotal, Math.min(requestedPercent, 100));
    const target = fixedCap === undefined ? requested : Math.min(requested, fixedCap);
    const decision = evaluateCombinedDiscount(cart, rules, target);
    if (decision.kind !== "authorized" || decision.cartDiscountCents <= 0) return blocked(decision.reason);
    const margin = assessIncentiveMargin(cart, { totalDiscount: decision.cartDiscountCents / 100 });
    return { approved: true, type: "discount_percent", value: decision.cartDiscountCents * 100 / subtotal,
      reason: decision.reason === "discount_allowed" && target < requested ? "capped_by_reais_limit" : decision.reason,
      marginAfterOffer: margin.marginPercent ?? 0 };
  }
  if (cart.currency !== "BRL") return blocked("incentive_currency_unsupported");
  if (!Number.isFinite(requestedPercent) || !Number.isFinite(rules.maxDiscountPercent) ||
      rules.maxDiscountPercent < 0 || rules.maxDiscountPercent > 100 ||
      (maxReaisCap != null && moneyCents(maxReaisCap) === null)) return blocked("economic_input_invalid");
  if (requestedPercent <= 0 || rules.maxDiscountPercent === 0 || cart.total <= 0) return blocked("discount_not_requested");
  const total = moneyCents(cart.total);
  const existingDiscount = moneyCents(cart.currentDiscount ?? 0);
  if (total === null || existingDiscount === null || existingDiscount > total) return blocked("economic_input_invalid");
  const percentCap = Math.min(requestedPercent, rules.maxDiscountPercent);
  // Never round an incentive above the merchant's percentage or fixed cap.
  const rawCents = Math.floor(Number((total * percentCap / 100).toFixed(6)));
  const effectiveCents = Math.min(rawCents, maxReaisCap == null ? rawCents : moneyCents(maxReaisCap)!);
  if (effectiveCents <= 0) return blocked("discount_not_requested");
  const maxDiscountCents = Math.floor(Number((total * rules.maxDiscountPercent / 100).toFixed(6)));
  if (existingDiscount > maxDiscountCents) return blocked("existing_discount_above_limit");
  // Legacy diagnostics only; neither a loss nor unavailable cost blocks the ceiling policy.
  const margin = assessIncentiveMargin(cart, { totalDiscount: Math.max(existingDiscount, effectiveCents) / 100 });
  return {
    approved: true, type: "discount_percent", value: effectiveCents * 100 / total,
    reason: effectiveCents < rawCents ? "capped_by_reais_limit"
      : percentCap < requestedPercent ? "capped_by_max_discount_rule" : "discount_allowed",
    marginAfterOffer: margin.marginPercent ?? 0,
  };
}

import type { Cart, MerchantRules, ShippingQuote } from "@zyon/shared-types";
import { assessIncentiveMargin, evaluateDiscountOffer, meetsMarginFloor, moneyCents } from "@zyon/rules-engine";
import { authorizeShippingDiscount } from "@zyon/shipping-engine";
import type { StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";
import { progressiveIncentiveStages } from "./strategy-incentive-recommendation.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";

/** The same authority evaluates historical planning and each live order.
 * Shipping is a labeled discount on the order total: the carrier quote remains
 * intact and payment/ledger account the benefit exactly once. */
export function assessExecutableIncentive(cart: Cart, rules: MerchantRules,
  recommendation: StrategyIncentiveRecommendation, shipping?: ShippingQuote, progressiveStage: 0 | 1 = 1) {
  if (recommendation.status !== "recommended" || cart.currency !== "BRL" || !Array.isArray(cart.items) || !cart.items.length
    || cart.items.length > 100 || cart.commercialNudge || (cart.currentDiscount ?? 0) !== 0) return null;
  const total = moneyCents(cart.total), t = recommendation.test;
  if (total === null || total < t.audience.minCartTotalCents || total > t.audience.maxCartTotalCents
    || rules.autonomousEngineEnabled !== true || !Number.isFinite(t.discountPercent) || t.discountPercent <= 0
    || t.discountPercent > rules.maxDiscountPercent || rules.minimumMarginPercent !== t.minimumMarginPercent
    || !Number.isSafeInteger(t.maxDiscountCents) || t.maxDiscountCents < 1) return null;
  const commercial = ["weekly-incentive-recommendation-v3", "weekly-incentive-recommendation-v4"].includes(recommendation.definition);
  if (!commercial && t.kind !== "capped_percentage_discount") return null;
  if (commercial && (!t.delivery || !["automatic", "coupon_code"].includes(t.delivery.mode)
    || (t.delivery.mode === "coupon_code" && !/^ZYON[A-F0-9]{20}$/.test(t.delivery.code)))) return null;
  let percent = t.discountPercent, cap = t.maxDiscountCents;
  if (t.kind === "capped_progressive_discount") {
    const expected = progressiveIncentiveStages(t.discountPercent, t.maxDiscountCents);
    if (recommendation.definition !== "weekly-incentive-recommendation-v4" || t.delivery?.mode !== "automatic"
      || !expected || !t.stages || digest(t.stages) !== digest(expected) || ![0, 1].includes(progressiveStage)) return null;
    percent = expected[progressiveStage].discountPercent;
    cap = expected[progressiveStage].maxDiscountCents;
  } else if (t.stages) return null;
  const percentageCents = Number(BigInt(total) * BigInt(Math.round(percent * 100)) / 10000n);
  let amountCents: number;
  if (t.kind === "capped_shipping_discount") {
    const price = moneyCents(shipping?.customerPrice);
    if (t.shippingDiscountCents !== t.maxDiscountCents || price === null || price <= 0) return null;
    amountCents = Math.min(t.shippingDiscountCents, price);
    if (amountCents > percentageCents || !authorizeShippingDiscount({ cart, shipping, rules,
      requestedDiscount: amountCents / 100, type: "shipping_discount_fixed" }).approved) return null;
  } else if (t.kind === "capped_fixed_discount") {
    if (t.fixedDiscountCents !== t.maxDiscountCents || t.fixedDiscountCents > percentageCents) return null;
    amountCents = t.fixedDiscountCents;
  } else if (t.kind === "capped_percentage_discount" || t.kind === "capped_progressive_discount") amountCents = Math.min(cap, percentageCents);
  else return null;
  if (amountCents <= 0 || !evaluateDiscountOffer(cart, rules, percent, amountCents / 100).approved) return null;
  if (commercial && shipping && (moneyCents(shipping.customerPrice) === null || moneyCents(shipping.realCost) === null
    || shipping.customerPrice < shipping.realCost!)) return null;
  const margin = assessIncentiveMargin(cart, { totalDiscount: amountCents / 100,
    ...(commercial && shipping ? { shippingRevenue: shipping.customerPrice, shippingCost: shipping.realCost } : {}) });
  return meetsMarginFloor(margin, rules.minimumMarginPercent) && margin.productCostCents !== null
    ? { amountCents, costCents: margin.productCostCents } : null;
}

import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";

type Recommendation = NonNullable<StrategyProposal["incentiveRecommendation"]>;
export type IncentiveTest = NonNullable<Recommendation["test"]>;
export type IncentiveBenefitLabel = "desconto" | "cupom" | "desconto no frete";

/** The review UI must understand every financial term before offering approval. */
export function validIncentiveTest(r: Recommendation): r is Recommendation & { test: IncentiveTest } {
  const t = r.test, modern = r.definition === "weekly-incentive-recommendation-v3";
  if (!["weekly-incentive-recommendation-v1", "weekly-incentive-recommendation-v2", "weekly-incentive-recommendation-v3"].includes(r.definition)
    || r.execution !== "unavailable" || r.approval !== "separate_incentive_review_required" || r.budgetStatus !== "not_reserved"
    || r.status !== "recommended" || !t || t.currency !== "BRL"
    || t.start !== "after_specific_approval" || t.allocation !== "50/50" || t.maxPerBuyer !== 1 || t.durationDays !== 7
    || t.control !== "current_checkout_without_test_incentive" || t.stacking !== "no_other_coupon_or_incentive"
    || t.audience?.consent !== "required" || t.audience?.holdout !== "excluded"
    || t.audience?.identity !== "first_eligible_session_per_buyer" || typeof t.audience.intent !== "string" || !t.audience.intent.trim()
    || t.measurement?.result !== "not_measured" || t.measurement?.samplePlanning !== (r.definition === "weekly-incentive-recommendation-v1"
      ? "required_before_activation" : "included_in_recommendation") || t.measurement?.conversionWindowHours !== 168
    || [t.maxDiscountCents, t.limitCents, t.maxRedemptions, t.audience.minCartTotalCents, t.audience.maxCartTotalCents]
      .some(n => !Number.isSafeInteger(n) || n <= 0)
    || !Number.isFinite(t.discountPercent) || t.discountPercent <= 0 || t.discountPercent > 100
    || !Number.isFinite(t.minimumMarginPercent) || t.minimumMarginPercent < 0 || t.minimumMarginPercent > 100
    || t.audience.maxCartTotalCents < t.audience.minCartTotalCents
    || t.limitCents !== t.maxDiscountCents * t.maxRedemptions) return false;
  if (!modern) return t.kind === "capped_percentage_discount" && t.delivery === undefined
    && t.fixedDiscountCents === undefined && t.shippingDiscountCents === undefined;
  if (!t.delivery || !["automatic", "coupon_code"].includes(t.delivery.mode)
    || (t.delivery.mode === "coupon_code" && (typeof t.delivery.code !== "string" || !/^ZYON[A-F0-9]{20}$/.test(t.delivery.code)))
    || (t.delivery.mode === "automatic" && "code" in t.delivery)) return false;
  if (t.kind === "capped_percentage_discount") return t.fixedDiscountCents === undefined && t.shippingDiscountCents === undefined;
  if (t.kind === "capped_fixed_discount") return t.fixedDiscountCents === t.maxDiscountCents && t.shippingDiscountCents === undefined;
  if (t.kind === "capped_shipping_discount") return t.shippingDiscountCents === t.maxDiscountCents && t.fixedDiscountCents === undefined;
  return false;
}

export function incentiveBenefitLabel(test: IncentiveTest): IncentiveBenefitLabel {
  return test.delivery?.mode === "coupon_code" ? "cupom" : test.kind === "capped_shipping_discount" ? "desconto no frete" : "desconto";
}

export function incentiveOfferText(test: IncentiveTest): string {
  const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (test.kind === "capped_fixed_discount") return `${money(test.fixedDiscountCents!)} de desconto por compra`;
  if (test.kind === "capped_shipping_discount") return `Até ${money(test.shippingDiscountCents!)} de desconto no frete`;
  return `${test.discountPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%, até ${money(test.maxDiscountCents)} por compra`;
}

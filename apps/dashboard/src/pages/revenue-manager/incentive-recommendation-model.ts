import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";

type Recommendation = NonNullable<StrategyProposal["incentiveRecommendation"]>;
export type IncentiveTest = NonNullable<Recommendation["test"]>;
export type IncentiveBenefitLabel = "desconto" | "cupom" | "desconto no frete" | "desconto progressivo";

/** The review UI must understand every financial term before offering approval. */
export function validIncentiveTest(r: Recommendation): r is Recommendation & { test: IncentiveTest } {
  const t = r.test, v4 = r.definition === "weekly-incentive-recommendation-v4";
  const modern = r.definition === "weekly-incentive-recommendation-v3" || v4;
  if (!["weekly-incentive-recommendation-v1", "weekly-incentive-recommendation-v2", "weekly-incentive-recommendation-v3", "weekly-incentive-recommendation-v4"].includes(r.definition)
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
  if (!v4 && (r.selectedCandidateKey !== undefined || r.policyProposal !== undefined || t.stages !== undefined)) return false;
  if (v4 && r.selectedCandidateKey !== ({ capped_percentage_discount: "percentage", capped_fixed_discount: "fixed",
    capped_shipping_discount: "shipping", capped_progressive_discount: "progressive" } as const)[t.kind]) return false;
  if (r.policyProposal !== undefined && (!r.policyProposal || !r.financialPolicy
    || r.policyProposal.definition !== "incentive-policy-proposal-v1"
    || r.policyProposal.basis !== "observed_safe_offer_and_required_sample"
    || !Number.isSafeInteger(r.policyProposal.previousPolicyVersion) || r.policyProposal.previousPolicyVersion < 0
    || !/^[a-f0-9]{64}$/.test(r.policyProposal.previousPolicyHash)
    || r.financialPolicy.version !== r.policyProposal.previousPolicyVersion + 1 || r.financialPolicy.enabled !== true
    || r.financialPolicy.limitCents !== t.limitCents || r.financialPolicy.maxDiscountCents !== t.maxDiscountCents
    || r.financialPolicy.maxRedemptions !== t.maxRedemptions)) return false;
  if (!modern) return t.kind === "capped_percentage_discount" && t.delivery === undefined
    && t.fixedDiscountCents === undefined && t.shippingDiscountCents === undefined;
  if (!t.delivery || !["automatic", "coupon_code"].includes(t.delivery.mode)
    || (t.delivery.mode === "coupon_code" && (typeof t.delivery.code !== "string" || !/^ZYON[A-F0-9]{20}$/.test(t.delivery.code)))
    || (t.delivery.mode === "automatic" && "code" in t.delivery)) return false;
  if (t.kind === "capped_progressive_discount") {
    const stages = t.stages;
    return v4 && t.delivery.mode === "automatic" && t.fixedDiscountCents === undefined && t.shippingDiscountCents === undefined
      && Array.isArray(stages) && stages.length === 2 && stages[0]?.index === 0 && stages[0]?.trigger === "enrollment"
      && stages[1]?.index === 1 && stages[1]?.trigger === "checkout_payment_ready"
      && stages[0].discountPercent === Math.floor(Math.round(t.discountPercent * 100) / 2) / 100
      && stages[0].maxDiscountCents === Math.floor(t.maxDiscountCents / 2)
      && stages[0].discountPercent > 0 && stages[0].maxDiscountCents > 0
      && stages[1].discountPercent === t.discountPercent && stages[1].maxDiscountCents === t.maxDiscountCents;
  }
  if (t.stages !== undefined) return false;
  if (t.kind === "capped_percentage_discount") return t.fixedDiscountCents === undefined && t.shippingDiscountCents === undefined;
  if (t.kind === "capped_fixed_discount") return t.fixedDiscountCents === t.maxDiscountCents && t.shippingDiscountCents === undefined;
  if (t.kind === "capped_shipping_discount") return t.shippingDiscountCents === t.maxDiscountCents && t.fixedDiscountCents === undefined;
  return false;
}

export function incentiveBenefitLabel(test: IncentiveTest): IncentiveBenefitLabel {
  return test.delivery?.mode === "coupon_code" ? "cupom" : test.kind === "capped_shipping_discount" ? "desconto no frete"
    : test.kind === "capped_progressive_discount" ? "desconto progressivo" : "desconto";
}

export function incentiveOfferText(test: IncentiveTest): string {
  const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (test.kind === "capped_fixed_discount") return `${money(test.fixedDiscountCents!)} de desconto por compra`;
  if (test.kind === "capped_shipping_discount") return `Até ${money(test.shippingDiscountCents!)} de desconto no frete`;
  if (test.kind === "capped_progressive_discount") return `Desconto em duas etapas, até ${test.discountPercent.toLocaleString("pt-BR")}% e ${money(test.maxDiscountCents)} por compra`;
  return `${test.discountPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%, até ${money(test.maxDiscountCents)} por compra`;
}

export function strategyActionMode(proposal: StrategyProposal): "legacy" | "communication" | "commercial" | "unsupported" {
  const decision = proposal.orchestration;
  if (decision === undefined) return "legacy";
  if (!decision || decision.definition !== "revenue-strategy-orchestration-v1" || decision.tool !== "submit_revenue_strategy"
    || !/^[a-f0-9]{64}$/.test(decision.catalogHash) || typeof decision.rationale !== "string"
    || !decision.rationale.trim() || decision.rationale.length > 2000) return "unsupported";
  if (decision.selectedAction === "communication_only") return proposal.incentiveRecommendation === undefined ? "communication" : "unsupported";
  return /^[a-f0-9]{64}$/.test(decision.selectedAction) && proposal.incentiveRecommendation
    && validIncentiveTest(proposal.incentiveRecommendation) ? "commercial" : "unsupported";
}

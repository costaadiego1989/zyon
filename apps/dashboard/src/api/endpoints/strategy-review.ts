/** Read projection of the immutable strategy document. Never sent back as authority. */
export interface StrategyProposal {
  definition: "checkout-strategy-review-v1";
  recommendation: {
    hypothesis_text: string; reasoning: string; expected_lift_percent: number;
    template: { name: string; description: string;
      variant_a: { name: string; system_prompt: string; weight: number; is_control: boolean };
      variant_b: { name: string; system_prompt: string; weight: number; is_control: boolean } };
  };
  observation: { observation_window_start: string; observation_window_end: string;
    funnel: { total_sessions: number; conversion_rate: number | null };
    data_quality?: { mature_sessions?: number; missing_metrics?: string[] } };
  rules: { maxDiscountPercent: number; minimumMarginPercent: number; allowFreeShipping: boolean; maxShippingSubsidy: number };
  baselineStatus: "awaiting_checkout_contract" | "primary_chat_contract_captured";
  checkoutBaseline?: { contextExit?: string; suppressionRecovery?: string };
  execution: "unavailable";
  expectedLiftStatus: "not_estimated" | "model_estimate_not_measured";
  orchestration?: { definition: "revenue-strategy-orchestration-v1"; tool: "submit_revenue_strategy";
    catalogHash: string; selectedAction: string; rationale: string };
  incentiveRecommendation?: {
    definition: "weekly-incentive-recommendation-v1" | "weekly-incentive-recommendation-v2" | "weekly-incentive-recommendation-v3" | "weekly-incentive-recommendation-v4";
    selectedCandidateKey?: "percentage" | "fixed" | "shipping" | "progressive";
    policyProposal?: { definition: "incentive-policy-proposal-v1"; previousPolicyVersion: number;
      previousPolicyHash: string; basis: "observed_safe_offer_and_required_sample" };
    planning?: {
      definition: "incentive-fixed-horizon-planning-v1";
      baseline: { buyers: number; conversions: number; complete: boolean; windowStart: string; windowEnd: string };
      durationDays: 7; conversionWindowHours: 168; allocation: "50/50";
      minimumEffectBps: 100; confidence: 0.95; planningPower: 0.8;
      minimumBuyersPerArm: number | null; weeklyBuyersPerArm: number | null;
      fundedTreatmentBuyers: number; requiredBudgetCents: number | null;
      status: "blocked" | "estimated_feasible"; result: "not_measured";
      blockers: string[];
    };
    approval: "separate_incentive_review_required"; execution: "unavailable"; budgetStatus: "not_reserved";
    financialPolicy: { version: number; policyHash: string; enabled?: boolean; limitCents?: number; maxDiscountCents?: number; maxRedemptions?: number };
    status: "recommended" | "not_recommended";
    reason?: "no_safe_candidate" | "financial_policy_disabled";
    test?: {
      kind: "capped_percentage_discount" | "capped_fixed_discount" | "capped_shipping_discount" | "capped_progressive_discount"; currency: "BRL";
      stages?: [{ index: 0; trigger: "enrollment"; discountPercent: number; maxDiscountCents: number },
        { index: 1; trigger: "checkout_payment_ready"; discountPercent: number; maxDiscountCents: number }];
      fixedDiscountCents?: number; shippingDiscountCents?: number;
      delivery?: { mode: "automatic" } | { mode: "coupon_code"; code: string };
      audience: { intent: string; consent: "required"; identity: "first_eligible_session_per_buyer";
        holdout: "excluded"; minCartTotalCents: number; maxCartTotalCents: number };
      discountPercent: number; maxDiscountCents: number; limitCents: number; maxRedemptions: number;
      maxPerBuyer: 1; durationDays: 7; start: "after_specific_approval"; allocation: "50/50";
      control: "current_checkout_without_test_incentive"; stacking: "no_other_coupon_or_incentive";
      minimumMarginPercent: number;
      measurement: { result: "not_measured"; samplePlanning: "required_before_activation" | "included_in_recommendation"; conversionWindowHours: 168 };
    };
  };
  discountStudy?: {
    definition: "weekly-discount-study-v1" | "weekly-discount-study-v2" | "weekly-discount-study-v3";
    commercialCandidates?: Array<{ key: "percentage" | "fixed" | "shipping" | "progressive";
      kind: "capped_percentage_discount" | "capped_fixed_discount" | "capped_shipping_discount" | "capped_progressive_discount";
      maxDiscountCents: number; delivery: "automatic" | "coupon_code";
      evidence: { basis: "percentage_discount_replay" | "similar_cart_values" | "observed_shipping_burden" | "progressive_safe_replay";
        sampleSize: number; minShippingCents?: number; maxShippingCents?: number; maxShippingCostCents?: number } }>;
    commercialCandidate?: null | {
      kind: "capped_percentage_discount" | "capped_fixed_discount" | "capped_shipping_discount";
      maxDiscountCents: number; delivery: "automatic" | "coupon_code";
      evidence: { basis: "percentage_discount_replay" | "similar_cart_values" | "observed_shipping_burden";
        sampleSize: number; minShippingCents?: number; maxShippingCents?: number; maxShippingCostCents?: number };
    };
    asOf: string; capturedAt: string; lookbackDays: 28;
    approvalScope: "communication_only"; commercialBudget: "not_reserved";
    status: "candidate_available" | "no_safe_candidate";
    candidate?: { intent: string; percent: number; simulation: {
      sampleSize: number; observedConversionRate: number; minimumProjectedMarginPercent: number;
      minCartTotalCents: number; maxCartTotalCents: number; maxDiscountCents: number;
      replayDiscountTotalCents: number; paymentFeeAssumptionPercent: number; conversionWindowHours: number;
    } };
  };
  experimentReview?: {
    definition: "checkout-strategy-experiment-review-v1";
    registration: "proposal_only_not_activated";
    capacity: "estimated_sufficient" | "below_planned_sample";
    planning: { capturedAt: string; population: { definition: "checkout-first-session-per-buyer-v1" } };
    plan: { definitionVersion: "session-conversion-fixed-horizon-v1"; durationDays: number;
      conversionWindowHours: number; minimumEffectBps: number; minimumSessionsPerArm: number;
      confidence: number; planningPower: number; allocation: string;
      trafficEstimate: { sessionsPerArm: number; reachesPlannedSample: boolean };
      baseline: { sessions: number; conversions: number; windowStart: string; windowEnd: string } };
  };
}

export interface StrategyVersion {
  version: number; proposalHash: string; proposal: StrategyProposal; createdAt: string; expiresAt: string;
  incentivePolicyCurrent?: boolean | null;
}
export interface StrategyAction {
  id: string; kind: string; version: number; feedback: string | null; createdAt: string;
  revision: null | { status: string; reason: string | null; completedAt: string | null };
}
export interface StrategyReview {
  id: string; merchantId: string; currentVersion: number; status: string;
  versions: StrategyVersion[]; actions: StrategyAction[];
  expired: boolean; approval_available: boolean; activation_available: boolean;
  revision_available: boolean; activation_blockers: string[];
  incentive_alternative_available?: boolean;
  decision_available?: boolean;
  measurement_status: string; measurement_warnings: string[];
}
export interface StrategyReviewCommand {
  version: number; proposal_hash: string; request_key: string; feedback?: string;
}
export interface StrategyReviewReceipt {
  action_id: string; strategy_id: string; version: number; proposal_hash: string;
  status: "rejected" | "revision_requested" | "active";
  execution_id?: string; experiment_id?: string; started_at?: string; ends_at?: string;
}

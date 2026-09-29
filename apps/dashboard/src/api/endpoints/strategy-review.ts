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
  expectedLiftStatus: "model_estimate_not_measured";
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

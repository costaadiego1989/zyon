export type IncentiveDecision = "approve" | "reject" | "withdraw";
export type IncentiveReviewCommand = { version: number; proposal_hash: string; recommendation_hash: string; request_key: string };
export type IncentiveAlternativeCommand = IncentiveReviewCommand & { feedback?: string };
export type IncentiveAlternativeReceipt = { action_id: string; strategy_id: string; version: number; proposal_hash: string;
  status: "revision_requested"; revision_scope: "incentive" };
export type IncentiveReviewReceipt = {
  review_id: string; strategy_id: string; version: number; proposal_hash: string; recommendation_hash: string;
  kind: IncentiveDecision; status: "approved_awaiting_activation" | "rejected" | "withdrawn";
  scope: "incentive_recommendation_only"; effect: "decision_recorded"; reviewed_at: string; approval_expires_at: string;
};
export type IncentiveReview = {
  strategy_id: string; version: number; proposal_hash: string; recommendation_hash: string | null;
  status: string; decision: IncentiveReviewReceipt | null; history: IncentiveReviewReceipt[];
  approval_available: boolean; rejection_available: boolean; withdrawal_available: boolean; approval_blockers: string[];
  execution_status: "unavailable" | "scheduled" | "active" | "suspended" | "ended" | "withdrawn";
  activation_available?: boolean;
  execution?: null | { id: string; started_at: string; ends_at: string };
  budget: null | { status: string; reservedCents: number; spentCents: number };
};

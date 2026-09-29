export type IncentiveDecision = "approve" | "reject" | "withdraw";
export type IncentiveReviewCommand = { version: number; proposal_hash: string; recommendation_hash: string; request_key: string };
export type IncentiveReviewReceipt = {
  review_id: string; strategy_id: string; version: number; proposal_hash: string; recommendation_hash: string;
  kind: IncentiveDecision; status: "approved_awaiting_activation" | "rejected" | "withdrawn";
  scope: "incentive_recommendation_only"; effect: "decision_recorded"; reviewed_at: string; approval_expires_at: string;
};
export type IncentiveReview = {
  strategy_id: string; version: number; proposal_hash: string; recommendation_hash: string | null;
  status: string; decision: IncentiveReviewReceipt | null; history: IncentiveReviewReceipt[];
  approval_available: boolean; rejection_available: boolean; withdrawal_available: boolean; approval_blockers: string[];
  execution_status: "unavailable";
  budget: null | { status: string; reservedCents: number; spentCents: number };
};

import type { Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { assertProposedIncentivePolicy } from "../domain/incentive-policy-proposal.js";
import { readIncentivePolicyState } from "./incentive-policy.reader.js";

export async function incentivePolicySupportsRecommendation(tx: Prisma.TransactionClient, merchantId: string,
  recommendation: StrategyIncentiveRecommendation | undefined) {
  if (!recommendation) return false;
  const state = await readIncentivePolicyState(tx, merchantId), proposed = recommendation.policyProposal;
  if (!proposed) return state.snapshot.enabled && digest(state.snapshot) === digest(recommendation.financialPolicy);
  if (state.mode !== "automatic") return false;
  if (state.approvedReviewId && state.snapshot.enabled && digest(state.snapshot) === digest(recommendation.financialPolicy)) return true;
  return state.snapshot.version === proposed.previousPolicyVersion && state.snapshot.policyHash === proposed.previousPolicyHash
    && recommendation.financialPolicy.version === state.snapshot.version + 1;
}

/** Only invoked after the exact proposal passes all approval prerequisites.
 * A deferred DB constraint requires the matching approve receipt by commit;
 * failed activation rolls this policy back with the review and budget. */
export async function materializeApprovedIncentivePolicy(tx: Prisma.TransactionClient, input: {
  merchantId: string; recommendation: StrategyIncentiveRecommendation; asOf: string; actorId: string; reviewId: string;
}) {
  const { recommendation: r } = input, p = r.policyProposal;
  if (!p) return;
  if (r.definition !== "weekly-incentive-recommendation-v4" || r.status !== "recommended" || !r.planning
    || r.planning.status !== "estimated_feasible") throw new Error("STRATEGY_INVALID_PROPOSED_INCENTIVE_POLICY");
  assertProposedIncentivePolicy(r.financialPolicy, p, r.planning.baseline, input.asOf);
  const state = await readIncentivePolicyState(tx, input.merchantId);
  if (state.mode !== "automatic" || state.snapshot.version !== p.previousPolicyVersion || state.snapshot.policyHash !== p.previousPolicyHash) {
    throw new Error("INCENTIVE_POLICY_CHANGED");
  }
  const next = r.financialPolicy;
  await tx.merchantIncentivePolicy.create({ data: { merchantId: input.merchantId, version: next.version,
    origin: "automatic", approvedReviewId: input.reviewId, actorId: input.actorId,
    requestKey: `strategy-policy:${input.reviewId}`, requestHash: digest(input), policyHash: next.policyHash,
    enabled: next.enabled, limitCents: next.limitCents, maxDiscountCents: next.maxDiscountCents, maxRedemptions: next.maxRedemptions } });
}

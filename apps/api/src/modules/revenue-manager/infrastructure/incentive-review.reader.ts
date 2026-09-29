import type { Prisma, StrategyIncentiveReview } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { IncentiveBudgetTerms } from "../domain/incentive-budget.js";

export function incentiveReviewReceipt(row: StrategyIncentiveReview) {
  return { review_id: row.id, strategy_id: row.strategyId, version: row.version,
    proposal_hash: row.proposalHash, recommendation_hash: row.recommendationHash,
    kind: row.kind, status: row.kind === "approve" ? "approved_awaiting_activation" : row.kind === "reject" ? "rejected" : "withdrawn",
    scope: "incentive_recommendation_only", effect: "decision_recorded",
    reviewed_at: row.createdAt.toISOString(), approval_expires_at: row.expiresAt.toISOString() };
}

/** An exact historical receipt is not a current authorization. Always fence the
 * mutable head before financing; a concurrent withdrawal invalidates snapshots. */
export async function approvedIncentiveReview(tx: Prisma.TransactionClient, terms: IncentiveBudgetTerms, recommendation: unknown) {
  await tx.$queryRaw`SELECT current_sequence FROM strategy_incentive_review_heads
    WHERE strategy_id = ${terms.strategyId} AND merchant_id = ${terms.merchantId} AND version = ${terms.version} FOR SHARE`;
  const row = await tx.strategyIncentiveReview.findFirst({ where: { strategyId: terms.strategyId,
    merchantId: terms.merchantId, version: terms.version }, orderBy: { sequence: "desc" } });
  if (!row || row.kind !== "approve" || row.proposalHash !== terms.proposalHash
    || row.recommendationHash !== digest(recommendation) || row.policyVersion !== terms.policyVersion || row.policyHash !== terms.policyHash
    || Date.parse(terms.startsAt) >= row.expiresAt.getTime() || Date.parse(terms.startsAt) <= row.createdAt.getTime()) {
    throw new Error("INCENTIVE_SPECIFIC_APPROVAL_REQUIRED");
  }
  return row;
}

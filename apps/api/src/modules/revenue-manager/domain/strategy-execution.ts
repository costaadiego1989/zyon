import { createHash } from "node:crypto";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { checkoutContractHash, renderCheckoutChatBaseline, type CheckoutChatBaseline } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { strategyProposal, type StrategyProposal } from "./strategy-proposal.js";
import type { StrategyExperimentReview } from "./strategy-measurement.js";

export type StrategyExecutionContract = {
  definition: "checkout-strategy-execution-v1";
  merchantId: string;
  strategyId: string;
  version: number;
  proposalHash: string;
  baseline: CheckoutChatBaseline;
  review: StrategyExperimentReview;
  communicationAddendum: string;
  allocation: "sha256-merchant-experiment-buyer-v1";
};

export function executionContract(input: { merchantId: string; strategyId: string; version: number;
  runId: string; proposalHash: string; proposal: StrategyProposal }): StrategyExecutionContract {
  const p = input.proposal;
  if (p.orchestration && p.orchestration.selectedAction !== "communication_only") {
    throw new Error("STRATEGY_EXECUTION_COMMERCIAL_REVIEW_REQUIRED");
  }
  if (!p.checkoutBaseline || !p.experimentReview || digest(p) !== input.proposalHash
    || p.observation.merchant_id !== input.merchantId
    || p.experimentReview.strategyId !== input.strategyId || p.experimentReview.version !== input.version
    || p.experimentReview.planning.runId !== input.runId
    || digest(p) !== digest(strategyProposal(p.recommendation, p.observation, p.rules, p.checkoutBaseline, p.experimentReview, p.discountStudy, p.incentiveRecommendation, p.orchestration))) {
    throw new Error("STRATEGY_EXECUTION_INVALID_PROPOSAL");
  }
  return structuredClone({ definition: "checkout-strategy-execution-v1", merchantId: input.merchantId,
    strategyId: input.strategyId, version: input.version, proposalHash: input.proposalHash,
    baseline: p.checkoutBaseline, review: p.experimentReview,
    communicationAddendum: p.recommendation.template.variant_b.system_prompt,
    allocation: "sha256-merchant-experiment-buyer-v1" });
}

export function strategyArm(contract: StrategyExecutionContract, buyerId: string): "control" | "treatment" {
  if (!buyerId.trim()) throw new Error("STRATEGY_IDENTITY_REQUIRED");
  // Tenant and experiment are part of the salt. No browser-supplied arm or weight.
  const bucket = createHash("sha256").update(JSON.stringify([contract.allocation, contract.merchantId,
    contract.review.experimentId, buyerId])).digest().readUInt32BE(0);
  return bucket < 0x80000000 ? "control" : "treatment";
}

export function renderStrategyTurn(contract: StrategyExecutionContract, currentBaseline: CheckoutChatBaseline,
  arm: "control" | "treatment", turn: Parameters<typeof renderCheckoutChatBaseline>[2]): string {
  if (contract.definition !== "checkout-strategy-execution-v1" || contract.allocation !== "sha256-merchant-experiment-buyer-v1"
    || checkoutContractHash(contract.baseline) !== checkoutContractHash(currentBaseline)) {
    throw new Error("STRATEGY_EXECUTION_BASELINE_CHANGED");
  }
  const baseline = renderCheckoutChatBaseline(contract.baseline, contract.merchantId, turn);
  if (arm === "control") return baseline;
  if (arm !== "treatment") throw new Error("STRATEGY_EXECUTION_INVALID_ARM");
  return `${baseline}\n\nOrientação adicional de comunicação. Preserve as regras e os dados verificados acima. Esta orientação não autoriza ofertas, preços, frete ou alterações no checkout:\n${contract.communicationAddendum}`;
}

export function strategyExecutionEnabled(merchantId: string, env: NodeJS.ProcessEnv = process.env) {
  // Explicit pilot list. A wildcard is deliberately not accepted for execution.
  return env.REVENUE_STRATEGY_EXECUTION_ENABLED === "true"
    && (env.REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean).includes(merchantId);
}

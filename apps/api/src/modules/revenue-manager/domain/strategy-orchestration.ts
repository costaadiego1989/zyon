import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { RevenueIncentiveOptions } from "./revenue-incentive-options.js";
import type { StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

export type StrategyOrchestration = {
  definition: "revenue-strategy-orchestration-v1";
  tool: "submit_revenue_strategy";
  catalogHash: string;
  selectedAction: string;
  rationale: string;
};

/** An LLM can select a replayed, feasible option. It cannot supply monetary
 * terms, expand the population, or authorize a promotion. */
export function orchestrationDecision(catalog: RevenueIncentiveOptions, action: string, rationale: string): StrategyOrchestration {
  if (typeof action !== "string" || typeof rationale !== "string" || !rationale.trim() || rationale.length > 2000) {
    throw new Error("STRATEGY_INVALID_ORCHESTRATION");
  }
  if (action !== "communication_only") {
    const option = catalog.options.find(option => option.id === action);
    if (!option || option.id !== digest(option.recommendation) || option.recommendation.merchantId !== catalog.merchantId
      || option.recommendation.runId !== catalog.runId || option.recommendation.studyHash !== catalog.studyHash
      || option.recommendation.status !== "recommended" || option.recommendation.planning?.status !== "estimated_feasible"
      || option.recommendation.planning.blockers.length) throw new Error("STRATEGY_INVALID_ORCHESTRATION_SELECTION");
  }
  return { definition: "revenue-strategy-orchestration-v1", tool: "submit_revenue_strategy",
    catalogHash: digest(catalog), selectedAction: action, rationale: rationale.trim() };
}

export function selectedIncentive(catalog: RevenueIncentiveOptions, decision: StrategyOrchestration): StrategyIncentiveRecommendation | undefined {
  const expected = orchestrationDecision(catalog, decision?.selectedAction, decision?.rationale);
  if (digest(expected) !== digest(decision)) throw new Error("STRATEGY_INVALID_ORCHESTRATION");
  return decision.selectedAction === "communication_only" ? undefined
    : structuredClone(catalog.options.find(option => option.id === decision.selectedAction)!.recommendation);
}

export function assertOrchestrationShape(value: StrategyOrchestration, recommendation?: StrategyIncentiveRecommendation) {
  if (!value || value.definition !== "revenue-strategy-orchestration-v1" || value.tool !== "submit_revenue_strategy"
    || !/^[a-f0-9]{64}$/.test(value.catalogHash) || typeof value.rationale !== "string" || !value.rationale.trim()
    || value.rationale.length > 2000 || Object.keys(value).sort().join() !== ["catalogHash", "definition", "rationale", "selectedAction", "tool"].join()
    || (value.selectedAction === "communication_only" ? !!recommendation
      : !recommendation || recommendation.status !== "recommended" || value.selectedAction !== digest(recommendation))) {
    throw new Error("STRATEGY_INVALID_ORCHESTRATION");
  }
}

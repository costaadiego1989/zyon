import type { Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { RevenueIncentiveOptions } from "../domain/revenue-incentive-options.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import { selectedIncentive } from "../domain/strategy-orchestration.js";

export async function assertStoredStrategyOrchestration(tx: Prisma.TransactionClient, merchantId: string,
  runId: string, proposal: StrategyProposal): Promise<void> {
  const run = await tx.revenueAnalysisRun.findFirstOrThrow({ where: { id: runId, merchantId } });
  const catalog = run.incentiveOptionsJson as unknown as RevenueIncentiveOptions | null;
  if (!catalog && !proposal.orchestration) return;
  if (!catalog || !proposal.orchestration || catalog.merchantId !== merchantId || catalog.runId !== runId
    || catalog.studyHash !== digest(proposal.discountStudy)) throw new Error("STRATEGY_INVALID_ORCHESTRATION_CONTEXT");
  const chosen = selectedIncentive(catalog, proposal.orchestration);
  if (digest(chosen ?? null) !== digest(proposal.incentiveRecommendation ?? null)) {
    throw new Error("STRATEGY_INVALID_ORCHESTRATION_SELECTION");
  }
}

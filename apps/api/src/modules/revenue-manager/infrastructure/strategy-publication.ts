import type { Prisma } from "@prisma/client";
import type { HypothesisSnapshot } from "../domain/entities/hypothesis.entity.js";
import type { ObservationSnapshot } from "../domain/entities/observation.entity.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { strategyProposal } from "../domain/strategy-proposal.js";
import { WEEK_MS } from "../domain/weekly-analysis-policy.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { readCheckoutBaseline, lockCheckoutBaselineRows } from "./checkout-baseline.reader.js";
import { checkoutContractHash, type CheckoutChatBaseline } from "../../checkout/domain/services/checkout-chat-baseline.js";

/** Called inside the existing fenced hypothesis transaction: proposal, source and
 * notification either commit together or none of them do. No legacy backfill. */
export async function publishInitialStrategy(tx: Prisma.TransactionClient, snap: HypothesisSnapshot, runId: string, baseline?: CheckoutChatBaseline) {
  const prior = await tx.revenueStrategy.findFirst({ where: { id: snap.id, merchantId: snap.merchant_id } });
  if (prior) return;
  if (snap.status !== "pending_review" || snap.hypothesis_type === "discount_rule" || snap.discount_rule_json) {
    throw new Error("STRATEGY_COMMUNICATION_REVIEW_REQUIRED");
  }
  const run = await tx.revenueAnalysisRun.findFirstOrThrow({ where: { id: runId, merchantId: snap.merchant_id,
    observationId: snap.observation_id } });
  const row = await tx.revenueManagerObservation.findFirstOrThrow({ where: { id: snap.observation_id, merchantId: snap.merchant_id } });
  if (baseline) {
    await lockCheckoutBaselineRows(tx, snap.merchant_id);
    const current = await readCheckoutBaseline(tx, snap.merchant_id);
    if (!current || checkoutContractHash(current) !== checkoutContractHash(baseline)) throw new Error("STRATEGY_BASELINE_CHANGED");
  }
  await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${snap.merchant_id} FOR SHARE`;
  const rules = await tx.merchantRule.findUniqueOrThrow({ where: { merchantId: snap.merchant_id } });
  const observation: ObservationSnapshot = {
    id: row.id, merchant_id: row.merchantId, observation_window_start: row.observationWindowStart.toISOString(),
    observation_window_end: row.observationWindowEnd.toISOString(), created_at: row.createdAt.toISOString(), fingerprint: row.fingerprint,
    funnel: row.funnelJson as ObservationSnapshot["funnel"], abandonment: row.abandonmentJson as ObservationSnapshot["abandonment"],
    objections: row.objectionsJson as ObservationSnapshot["objections"], cross_sell: row.crossSellJson as ObservationSnapshot["cross_sell"],
    cohorts: row.cohortsJson as ObservationSnapshot["cohorts"], revenue: row.revenueJson as ObservationSnapshot["revenue"],
    data_quality: row.dataQualityJson as ObservationSnapshot["data_quality"], ai_costs_cents: row.aiCostsCents,
    ...(row.currentExperimentJson ? { current_experiment: row.currentExperimentJson as ObservationSnapshot["current_experiment"] } : {}),
  };
  const proposal = strategyProposal({ hypothesis_text: snap.hypothesis_text, reasoning: snap.reasoning,
    expected_lift_percent: snap.expected_lift_percent, template: snap.template }, observation, merchantRulesSnapshot(rules), baseline);
  const expiresAt = new Date((run.asOf ?? row.createdAt).getTime() + WEEK_MS);
  await tx.revenueStrategy.create({ data: { id: snap.id, merchantId: snap.merchant_id, runId,
    versions: { create: { version: 1, proposalHash: digest(proposal), proposal: proposal as unknown as Prisma.InputJsonValue, expiresAt } } } });
  await tx.merchantNotification.upsert({ where: { id: `strategy:${snap.id}` },
    update: {}, create: { id: `strategy:${snap.id}`, merchantId: snap.merchant_id, type: "ai_strategy_suggestion",
      title: "Nova estratégia para revisar", body: snap.hypothesis_text,
      metadata: { hypothesisId: snap.id, strategyId: snap.id, version: 1, proposalHash: digest(proposal) } } });
}

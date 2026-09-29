import type { Prisma, RevenueStrategy, RevenueStrategyVersion } from "@prisma/client";
import { executionContract, strategyExecutionEnabled } from "../domain/strategy-execution.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import { positiveInteger, weeklyAnalysisEnabled, weeklyMerchantAllowed } from "../domain/weekly-analysis-policy.js";
import { chatRequestsEnabled } from "../../checkout/domain/services/chat-message-identity.js";
import { chatPaymentRecoveryEnabled } from "../../checkout/domain/services/chat-payment-recovery.js";
import { checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { readCheckoutBaseline } from "./checkout-baseline.reader.js";
import { assertStoredMeasurementPlanning } from "./strategy-measurement-planning.js";
import { assertStoredDiscountStudy } from "./strategy-discount-study.js";

/** Read-only readiness, shared by the dashboard and the locked approval command.
 * It never reserves budget or calls a provider. Dispatch still revalidates both. */
export async function strategyActivationBlockers(tx: Prisma.TransactionClient, strategy: RevenueStrategy,
  version: RevenueStrategyVersion | undefined, eligible: boolean, now: Date) {
  const blockers: string[] = [];
  const merchantId = strategy.merchantId;
  if (process.env.REVENUE_STRATEGY_APPROVAL_ENABLED !== "true" || !strategyExecutionEnabled(merchantId)
    || !weeklyAnalysisEnabled() || !weeklyMerchantAllowed(merchantId)) blockers.push("activation_unavailable");
  if (!eligible) blockers.push("merchant_ineligible");
  if (strategy.status !== "pending_review") blockers.push("strategy_already_decided");
  if (!version || version.version !== strategy.currentVersion) return [...blockers, "current_version_required"];
  if (version.expiresAt <= now) blockers.push("proposal_expired");
  const proposal = version.proposal as unknown as StrategyProposal;
  if (!proposal?.checkoutBaseline) blockers.push("versioned_checkout_contract_required");
  if (!proposal?.experimentReview) blockers.push("reviewed_measurement_plan_required");
  let contract;
  try { contract = executionContract({ merchantId, strategyId: strategy.id, version: version.version,
    runId: strategy.runId, proposalHash: version.proposalHash, proposal }); }
  catch { return [...blockers, "proposal_requires_new_analysis"]; }
  try { await assertStoredDiscountStudy(tx, merchantId, strategy.runId, proposal.observation.id, proposal.rules, proposal.discountStudy, proposal.incentiveRecommendation); }
  catch { return [...blockers, "proposal_requires_new_analysis"]; }

  const flags = ["REVENUE_STRATEGY_MAIN_CHAT_ENABLED", "REVENUE_STRATEGY_CHAT_DISPATCH_ENABLED",
    "REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED", "REVENUE_STRATEGY_MONITOR_ENABLED",
    "CHECKOUT_CHAT_RECOVERY_ENABLED", "CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED"];
  if (flags.some(name => process.env[name] !== "true") || !chatRequestsEnabled(merchantId)
    || !chatPaymentRecoveryEnabled(merchantId)) blockers.push("checkout_execution_unavailable");
  const monitorLimit = Number(process.env.REVENUE_STRATEGY_MONITOR_BATCH_LIMIT ?? "100");
  if (!Number.isSafeInteger(monitorLimit) || monitorLimit < 1 || monitorLimit > 500) blockers.push("monitor_configuration_required");
  try {
    const queue = new URL(process.env.REDIS_URL ?? "");
    if (process.env.REDIS_ENABLED === "false" || !["redis:", "rediss:"].includes(queue.protocol) || !queue.hostname) throw new Error();
  } catch { blockers.push("monitor_configuration_required"); }
  const baseline = await readCheckoutBaseline(tx, merchantId);
  if (!baseline || checkoutContractHash(baseline) !== checkoutContractHash(contract.baseline)) blockers.push("checkout_baseline_changed");
  try { await assertStoredMeasurementPlanning(tx, merchantId, strategy.runId, contract.review.planning); }
  catch { blockers.push("measurement_context_changed"); }
  const run = await tx.revenueAnalysisRun.findFirst({ where: { id: strategy.runId, merchantId } });
  if (run?.status !== "completed" || !await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId } })) {
    blockers.push("weekly_analysis_required");
  }
  if (await tx.promptExperiment.count({ where: { merchantId, status: "running" } })
    || await tx.strategyExecution.count({ where: { merchantId, status: { in: ["running", "paused"] } } })) {
    blockers.push("experiment_already_active");
  }

  try {
    const maxInput = positiveInteger("REVENUE_AI_MAX_INPUT_TOKENS");
    const maxOutput = positiveInteger("REVENUE_AI_MAX_OUTPUT_TOKENS");
    const daily = BigInt(positiveInteger("REVENUE_AI_DAILY_LIMIT_MICROS"));
    const monthly = BigInt(positiveInteger("REVENUE_AI_MONTHLY_LIMIT_MICROS"));
    const execution = BigInt(positiveInteger("REVENUE_STRATEGY_AI_EXECUTION_LIMIT_MICROS"));
    for (const name of ["REVENUE_STRATEGY_AI_SESSION_MAX_CALLS", "REVENUE_AI_PROVIDER_RPM",
      "REVENUE_AI_PROVIDER_TPM", "REVENUE_AI_PROVIDER_CONCURRENCY"]) positiveInteger(name);
    const revisionPercent = Number(process.env.REVENUE_AI_REVISION_RESERVE_PERCENT);
    const currency = process.env.REVENUE_AI_BUDGET_CURRENCY;
    if (!currency || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(revisionPercent)
      || revisionPercent < 0 || revisionPercent >= 100 || maxOutput < contract.baseline.sampling.max_tokens) throw new Error();
    const price = await tx.aiPriceVersion.findFirst({ where: { provider: contract.baseline.provider.name,
      model: contract.baseline.provider.model, currency, channel: "chat", component: "text_generation",
      source: "revenue-upper-bound-v1", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { effectiveFrom: "desc" } });
    if (!price || price.inputMicrosPerMillion === null || price.outputMicrosPerMillion === null
      || price.inputMicrosPerMillion < 0n || price.outputMicrosPerMillion < 0n) blockers.push("ai_pricing_required");
    else {
      const reservation = (BigInt(maxInput) * price.inputMicrosPerMillion
        + BigInt(contract.baseline.sampling.max_tokens) * price.outputMicrosPerMillion + 999_999n) / 1_000_000n;
      if ([daily * BigInt(100 - revisionPercent) / 100n, monthly, execution].some(limit => reservation > limit)) {
        blockers.push("ai_budget_configuration_required");
      }
    }
  } catch { blockers.push("ai_budget_configuration_required"); }
  return [...new Set(blockers)];
}

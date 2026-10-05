import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { BillingPlanMeteringService } from "../../payment/domain/billing-plan-guard.js";
import { BILLING_PLANS } from "../../payment/domain/billing-plans.js";
import { incentiveKey } from "../domain/incentive-budget.js";
import type { StrategyProposal } from "../domain/strategy-proposal.js";
import { lockCheckoutBaselineRows } from "../infrastructure/checkout-baseline.reader.js";
import { merchantRulesSnapshot } from "../infrastructure/hypothesis-merchant-context.adapter.js";
import { readIncentivePolicy } from "../infrastructure/incentive-policy.reader.js";
import { incentiveReviewReceipt } from "../infrastructure/incentive-review.reader.js";
import { assertStoredDiscountStudy, commercialModesEnabled } from "../infrastructure/strategy-discount-study.js";
import { closeIncentiveBudget, readIncentiveBudget } from "../infrastructure/incentive-budget-ledger.js";
import { activateApprovedIncentive, incentiveActivationBlockers, incentiveExecutionEnabled } from "../infrastructure/incentive-execution-ledger.js";

export type IncentiveReviewCommand = { version: number; proposal_hash: string; recommendation_hash: string; request_key: string; feedback?: string };
export type IncentiveReviewKind = "approve" | "reject" | "withdraw";
type Tx = Prisma.TransactionClient;
const clock = async (tx: Tx) => (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
export const incentiveReviewEnabled = (merchantId: string) => process.env.REVENUE_INCENTIVE_REVIEW_ENABLED === "true"
  && (process.env.REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS ?? "").split(",").map(s => s.trim()).includes(merchantId);

@Injectable()
export class IncentiveReviewService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly billing: BillingPlanMeteringService) {}

  private async source(tx: Tx, merchantId: string, id: string, versionNumber?: number) {
    const strategy = await tx.revenueStrategy.findFirst({ where: { id, merchantId } });
    if (!strategy) throw new NotFoundException("INCENTIVE_STRATEGY_NOT_FOUND");
    const version = await tx.revenueStrategyVersion.findUnique({ where: { strategyId_merchantId_version: {
      strategyId: id, merchantId, version: versionNumber ?? strategy.currentVersion } } });
    if (!version) throw new NotFoundException("INCENTIVE_VERSION_NOT_FOUND");
    if (digest(version.proposal) !== version.proposalHash) throw new ConflictException("INCENTIVE_PROPOSAL_CORRUPT");
    const proposal = version.proposal as unknown as StrategyProposal;
    return { strategy, version, proposal, recommendation: proposal.incentiveRecommendation };
  }

  private async blockers(tx: Tx, source: Awaited<ReturnType<IncentiveReviewService["source"]>>, eligible: boolean, now: Date) {
    const { strategy, version, proposal, recommendation } = source;
    const reasons: string[] = [];
    if (!incentiveReviewEnabled(strategy.merchantId)) reasons.push("review_disabled");
    if (!eligible) reasons.push("plan_required");
    if (strategy.currentVersion !== version.version || !["pending_review", "activation_pending", "active"].includes(strategy.status)) reasons.push("proposal_unavailable");
    if (version.expiresAt <= now) reasons.push("proposal_expired");
    if (!recommendation || !["weekly-incentive-recommendation-v2", "weekly-incentive-recommendation-v3"].includes(recommendation.definition)
      || recommendation.status !== "recommended") reasons.push("planned_recommendation_required");
    if (recommendation?.planning?.status !== "estimated_feasible") reasons.push("measurement_blocked");
    if (recommendation?.definition === "weekly-incentive-recommendation-v3"
      && !commercialModesEnabled(strategy.merchantId)) reasons.push("commercial_modes_disabled");
    const policy = await readIncentivePolicy(tx, strategy.merchantId);
    if (!policy.enabled || !recommendation || digest(policy) !== digest(recommendation.financialPolicy)) reasons.push("financial_policy_changed");
    if (!await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId: strategy.merchantId } })) reasons.push("weekly_enrollment_required");
    const run = await tx.revenueAnalysisRun.findFirst({ where: { id: strategy.runId, merchantId: strategy.merchantId } });
    if (run?.status !== "completed") reasons.push("analysis_not_completed");
    const row = await tx.merchantRule.findUnique({ where: { merchantId: strategy.merchantId } });
    if (!row || !row.autonomousEngineEnabled || digest(merchantRulesSnapshot(row)) !== digest(proposal.rules)) reasons.push("merchant_rules_changed");
    else {
      try { await assertStoredDiscountStudy(tx, strategy.merchantId, strategy.runId, proposal.observation.id,
        merchantRulesSnapshot(row), proposal.discountStudy, recommendation); }
      catch (error) {
        // Only known document validation failures become readiness blockers.
        // Infrastructure errors must not look like a valid negative decision.
        if (!(error instanceof Error) || !/^STRATEGY_(INVALID_|DISCOUNT_STUDY_CHANGED|INCENTIVE_RECOMMENDATION_CHANGED)/.test(error.message)) throw error;
        reasons.push("recommendation_changed");
      }
    }
    return reasons;
  }

  async read(merchantId: string, id: string) {
    const eligible = BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.revenueManager;
    return this.prisma.$transaction(async tx => {
      const source = await this.source(tx, merchantId, id);
      const history = await tx.strategyIncentiveReview.findMany({ where: { merchantId, strategyId: id }, orderBy: [{ version: "desc" }, { sequence: "desc" }] });
      const latest = history.find(row => row.version === source.version.version);
      const now = await clock(tx);
      const blockers = await this.blockers(tx, source, eligible, now);
      const reviewed = latest ? incentiveReviewReceipt(latest) : null;
      const budget = await tx.strategyIncentiveBudget.findFirst({ where: { merchantId, strategyId: id, version: source.version.version } });
      const execution = await tx.strategyIncentiveExecution.findUnique({ where: { strategyId_merchantId: { strategyId: id, merchantId } } });
      const activationBlockers = await incentiveActivationBlockers(tx, merchantId, now);
      if (incentiveExecutionEnabled(merchantId) && !latest) {
        blockers.push(...activationBlockers);
        if (source.strategy.status !== "pending_review") blockers.push("incentive_activation_source_unavailable");
      }
      return { strategy_id: id, version: source.version.version, proposal_hash: source.version.proposalHash,
        recommendation_hash: source.recommendation ? digest(source.recommendation) : null,
        status: latest?.kind === "approve" && blockers.some(b => b !== "review_disabled" && b !== "plan_required")
          ? "approval_invalidated" : reviewed?.status ?? (source.recommendation?.status === "recommended" ? "awaiting_review" : "unavailable"),
        decision: reviewed, history: history.map(incentiveReviewReceipt),
        approval_available: !latest && blockers.length === 0, approval_blockers: [...blockers, ...(latest ? ["already_reviewed"] : [])],
        rejection_available: !latest && source.recommendation?.status === "recommended",
        withdrawal_available: latest?.kind === "approve",
        activation_available: !latest && !blockers.length && !activationBlockers.length && source.strategy.status === "pending_review",
        activation_blockers: activationBlockers,
        execution_status: !execution ? "unavailable" : budget?.closedAt ? "withdrawn" : now >= execution.endsAt ? "ended"
          : !incentiveExecutionEnabled(merchantId) || activationBlockers.includes("incentive_budget_disabled")
            || blockers.some(reason => !["review_disabled", "plan_required", "proposal_expired"].includes(reason)) ? "suspended"
          : now < execution.startedAt ? "scheduled" : "active",
        execution: execution ? { id: execution.id, started_at: execution.startedAt.toISOString(), ends_at: execution.endsAt.toISOString() } : null,
        budget: budget ? await readIncentiveBudget(tx, merchantId, budget.id) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Records exact consent; the separate, disabled-by-default runtime gate
   * composes activation and its budget in the same approval transaction. */
  async decide(merchantId: string, actorId: string, id: string, kind: IncentiveReviewKind, input: IncentiveReviewCommand) {
    this.validate(actorId, kind, input);
    input = structuredClone(input);
    const requestHash = digest({ actorId, kind, ...input });
    return this.prisma.$transaction(async tx => {
      await lockCheckoutBaselineRows(tx, merchantId);
      await tx.$queryRaw`SELECT current_version FROM merchant_incentive_policy_heads WHERE merchant_id = ${merchantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM revenue_strategies WHERE id = ${id} AND merchant_id = ${merchantId} FOR UPDATE`;
      const prior = await tx.strategyIncentiveReview.findUnique({ where: { strategyId_merchantId_requestKey: { strategyId: id, merchantId, requestKey: input.request_key } } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException("INCENTIVE_REVIEW_KEY_CONFLICT");
        return incentiveReviewReceipt(prior);
      }
      const source = await this.source(tx, merchantId, id, input.version);
      const { strategy, version, recommendation } = source;
      if (input.proposal_hash !== version.proposalHash || !recommendation || input.recommendation_hash !== digest(recommendation)) throw new ConflictException("INCENTIVE_REVIEW_PROPOSAL_CHANGED");
      const latest = await tx.strategyIncentiveReview.findFirst({ where: { merchantId, strategyId: id, version: input.version }, orderBy: { sequence: "desc" } });
      if (kind === "withdraw" ? latest?.kind !== "approve" : !!latest) throw new ConflictException("INCENTIVE_REVIEW_DECISION_CONFLICT");
      if (kind !== "withdraw" && (strategy.currentVersion !== input.version || recommendation.status !== "recommended")) throw new ConflictException("INCENTIVE_REVIEW_PROPOSAL_CHANGED");
      if (kind === "approve") {
        await tx.$queryRaw`SELECT id FROM revenue_analysis_runs WHERE id = ${strategy.runId} AND merchant_id = ${merchantId} FOR SHARE`;
        const eligible = BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.revenueManager;
        const blockers = await this.blockers(tx, source, eligible, await clock(tx));
        if (incentiveExecutionEnabled(merchantId)) {
          blockers.push(...await incentiveActivationBlockers(tx, merchantId, await clock(tx)));
          if (source.strategy.status !== "pending_review") blockers.push("incentive_activation_source_unavailable");
        }
        if (blockers.length) throw new ConflictException({ code: "INCENTIVE_REVIEW_PREREQUISITES_REQUIRED", blockers });
      }
      const row = await tx.strategyIncentiveReview.create({ data: { id: randomUUID(), merchantId, strategyId: id,
        version: input.version, sequence: kind === "withdraw" ? 2 : 1, kind, proposalHash: input.proposal_hash,
        recommendationHash: input.recommendation_hash, policyVersion: recommendation.financialPolicy.version,
        policyHash: recommendation.financialPolicy.policyHash, actorId, requestKey: input.request_key, requestHash,
        feedback: input.feedback, createdAt: await clock(tx), expiresAt: version.expiresAt } });
      const execution = kind === "approve" && incentiveExecutionEnabled(merchantId)
        ? await activateApprovedIncentive(tx, merchantId, id) : null;
      if (kind === "withdraw") {
        const budget = await tx.strategyIncentiveBudget.findFirst({ where: { merchantId, strategyId: id, version: input.version } });
        if (budget && !budget.closedAt) await closeIncentiveBudget(tx, { merchantId, budgetId: budget.id, actorId, reason: "Aprovação do incentivo cancelada pelo lojista" });
      }
      const receipt = incentiveReviewReceipt(row);
      await tx.merchantNotification.create({ data: { id: `strategy-incentive-review:${row.id}`, merchantId,
        type: "ai_strategy_suggestion", title: kind === "approve" ? "Proposta de incentivo aprovada" : kind === "reject" ? "Proposta de incentivo recusada" : "Aprovação do incentivo cancelada",
        body: kind === "approve" ? execution ? "O teste de desconto foi aprovado para sete dias, com orçamento e margem protegidos."
          : "A aprovação foi registrada. O teste de incentivo ainda não foi iniciado." : "A decisão sobre o incentivo foi registrada no Revenue Manager.",
        read: false, metadata: { strategyId: id, hypothesisId: id, version: row.version, incentiveReviewId: row.id, state: receipt.status } } });
      return receipt;
    });
  }

  private validate(actorId: string, kind: string, input: IncentiveReviewCommand) {
    const keys = ["version", "proposal_hash", "recommendation_hash", "request_key", "feedback"];
    const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))
      || !Number.isSafeInteger(input.version) || input.version < 1 || input.version > 2147483647
      || !hash(input.proposal_hash) || !hash(input.recommendation_hash) || !incentiveKey(input.request_key)
      || (input.feedback !== undefined && (typeof input.feedback !== "string" || input.feedback.length > 2000))
      || typeof actorId !== "string" || !actorId.trim() || actorId.length > 150 || !["approve", "reject", "withdraw"].includes(kind)) {
      throw new BadRequestException("INCENTIVE_REVIEW_INVALID_COMMAND");
    }
  }
}

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { BillingPlanMeteringService } from "../../payment/domain/billing-plan-guard.js";
import { BILLING_PLANS } from "../../payment/domain/billing-plans.js";
import { HYPOTHESIS_GENERATOR_PORT, type HypothesisGeneratorPort } from "../domain/ports/hypothesis-generator.port.js";
import { HYPOTHESIS_MERCHANT_CONTEXT_PORT, type HypothesisMerchantContextPort } from "../domain/ports/hypothesis-merchant-context.port.js";
import { strategyProposal, type StrategyProposal } from "../domain/strategy-proposal.js";
import { AnalysisDeferred, LEASE_MS, MAX_RUN_ATTEMPTS, positiveInteger, weeklyAnalysisEnabled, weeklyMerchantAllowed } from "../domain/weekly-analysis-policy.js";
import { merchantRulesSnapshot } from "../infrastructure/hypothesis-merchant-context.adapter.js";
import { readCheckoutBaseline, lockCheckoutBaselineRows } from "../infrastructure/checkout-baseline.reader.js";
import { checkoutBaselineReference, checkoutContractHash } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { assertStrategyExperimentReview, strategyExperimentReview } from "../domain/strategy-measurement.js";
import { assertCurrentMeasurementPolicy, assertStoredMeasurementPlanning } from "../infrastructure/strategy-measurement-planning.js";
import { strategyActivationBlockers } from "../infrastructure/strategy-activation-readiness.js";
import { executionClock, registerApprovedExecution } from "../infrastructure/strategy-execution-ledger.js";
import { assertStoredDiscountStudy } from "../infrastructure/strategy-discount-study.js";
import { readIncentivePolicy } from "../infrastructure/incentive-policy.reader.js";
import { conservativeIncentiveAlternative, type StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import type { RevenueIncentiveOptions } from "../domain/revenue-incentive-options.js";
import { selectedIncentive } from "../domain/strategy-orchestration.js";
import { assertStoredStrategyOrchestration } from "../infrastructure/strategy-orchestration.reader.js";
import { incentivePolicySupportsRecommendation } from "../infrastructure/incentive-policy-approval.js";

export type StrategyReviewCommand = { version: number; proposal_hash: string; request_key: string; feedback?: string };
export type IncentiveAlternativeCommand = StrategyReviewCommand & { recommendation_hash: string };
type ReviewKind = "approve" | "reject" | "revision";
export const revisionsEnabled = () => weeklyAnalysisEnabled() && process.env.REVENUE_STRATEGY_REVISIONS_ENABLED === "true";
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class StrategyReviewService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(HYPOTHESIS_MERCHANT_CONTEXT_PORT) private readonly context: HypothesisMerchantContextPort,
    @Inject(HYPOTHESIS_GENERATOR_PORT) private readonly generator: HypothesisGeneratorPort,
    private readonly billing: BillingPlanMeteringService) {}

  async list(merchantId: string, after?: string) {
    const rows = await this.prisma.revenueStrategy.findMany({ where: { merchantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" }, take: 21 });
    return { items: rows.slice(0, 20), next_cursor: rows.length > 20 ? rows[19].id : null };
  }

  /** Keep legacy discovery links useful without displaying a superseded proposal. */
  async summaries(merchantId: string, ids: string[]) {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$transaction(tx => tx.revenueStrategy.findMany({ where: { merchantId, id: { in: ids } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } } }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return new Map(rows.map(row => {
      const latest = row.versions[0];
      const proposal = latest?.proposal as unknown as StrategyProposal | undefined;
      return [row.id, { version: row.currentVersion, status: row.status,
        title: proposal?.recommendation.hypothesis_text, expires_at: latest?.expiresAt,
        expected_lift_percent: proposal?.recommendation.expected_lift_percent,
        ...(proposal?.orchestration ? { expected_lift_status: "not_estimated" as const } : {}) }];
    }));
  }

  async read(merchantId: string, id: string) {
    const eligible = BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.revenueManager;
    return this.prisma.$transaction(async tx => {
      const strategy = await tx.revenueStrategy.findFirst({ where: { id, merchantId } });
      if (!strategy) throw new NotFoundException("STRATEGY_NOT_FOUND");
      const versions = await tx.revenueStrategyVersion.findMany({ where: { strategyId: id, merchantId }, orderBy: { version: "desc" } });
      const actions = await tx.revenueStrategyAction.findMany({ where: { strategyId: id, merchantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { revision: { select: { status: true, reason: true, completedAt: true } } } });
      const limit = Number(process.env.REVENUE_AI_MAX_REVISIONS_PER_CYCLE);
      const current = versions[0]?.proposal as unknown as StrategyProposal | undefined;
      const financialPolicy = versions.some(v => (v.proposal as unknown as StrategyProposal).incentiveRecommendation)
        ? await readIncentivePolicy(tx, merchantId) : null;
      const projectedVersions = await Promise.all(versions.map(async version => {
        const recommendation = (version.proposal as unknown as StrategyProposal).incentiveRecommendation;
        return { ...version, incentivePolicyCurrent: recommendation && financialPolicy
          ? recommendation.policyProposal ? await incentivePolicySupportsRecommendation(tx, merchantId, recommendation)
            : recommendation.financialPolicy.policyHash === financialPolicy.policyHash : null };
      }));
      const blockers = await strategyActivationBlockers(tx, strategy, versions[0], eligible, new Date());
      const incentiveFunded = await tx.strategyIncentiveBudget.count({ where: { merchantId, strategyId: id } }) > 0;
      if (incentiveFunded) blockers.push("incentive_already_funded");
      let incentiveAlternativeAvailable = false;
      if (!incentiveFunded && eligible && revisionsEnabled() && weeklyMerchantAllowed(merchantId) && strategy.status === "pending_review"
        && versions[0]?.expiresAt > new Date() && Number.isSafeInteger(limit) && limit > 0
        && actions.filter(action => action.kind === "revision").length < limit && current?.incentiveRecommendation && !current.orchestration) {
        try { incentiveAlternativeAvailable = !!await this.alternative(tx, merchantId, strategy.id, strategy.runId, current); }
        catch (error) {
          if (!(error instanceof ConflictException) && !/STRATEGY_(INVALID|DISCOUNT_STUDY_CHANGED|INCENTIVE_RECOMMENDATION_CHANGED)/.test(String(error))) throw error;
        }
      }
      return { ...strategy, versions: projectedVersions, actions, approval_available: blockers.length === 0, activation_available: blockers.length === 0,
        decision_available: !incentiveFunded && strategy.status === "pending_review",
        incentive_alternative_available: incentiveAlternativeAvailable,
        expired: !!versions[0] && versions[0].expiresAt <= new Date(),
        activation_blockers: blockers,
        measurement_status: current?.experimentReview ? "included_in_proposal" : "awaiting_measurement_plan",
        measurement_warnings: current?.experimentReview?.capacity === "below_planned_sample" ? ["planned_sample_capacity_insufficient"] : [],
        revision_available: !incentiveFunded && revisionsEnabled() && weeklyMerchantAllowed(merchantId) && strategy.status === "pending_review"
          && !!versions[0] && versions[0].expiresAt > new Date() && Number.isSafeInteger(limit) && limit > 0
          && actions.filter(action => action.kind === "revision").length < limit };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Request identities are bound to actor, payload, action and exact proposal.
   * Retries return the original receipt, even after a newer version is published. */
  async requestIncentiveAlternative(merchantId: string, actorId: string, id: string, input: IncentiveAlternativeCommand, now = new Date()) {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["version", "proposal_hash", "recommendation_hash", "request_key", "feedback"].includes(key))
      || typeof input.recommendation_hash !== "string" || !/^[a-f0-9]{64}$/.test(input.recommendation_hash)
      || typeof actorId !== "string" || !actorId.trim() || actorId.length > 150) throw new BadRequestException("INCENTIVE_ALTERNATIVE_INVALID_COMMAND");
    this.validate(input);
    return this.decide(merchantId, actorId, id, "revision", { version: input.version, proposal_hash: input.proposal_hash,
      request_key: input.request_key, feedback: input.feedback?.trim() || "Sugira um desconto menor para o mesmo público, respeitando os limites configurados." },
    now, { recommendationHash: input.recommendation_hash });
  }

  async decide(merchantId: string, actorId: string, id: string, kind: ReviewKind, input: StrategyReviewCommand, now = new Date(),
    incentiveAlternative?: { recommendationHash: string }) {
    input = structuredClone(input);
    this.validate(input);
    if (!actorId?.trim()) throw new BadRequestException("STRATEGY_HUMAN_ACTOR_REQUIRED");
    const requestHash = digest({ actorId, kind, ...input, ...(incentiveAlternative ? { incentiveAlternative } : {}) });
    const eligible = kind === "approve" && BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.revenueManager;
    return this.prisma.$transaction(async tx => {
      const strategy = await this.lock(tx, merchantId, id);
      const previous = await tx.revenueStrategyAction.findFirst({ where: { merchantId, strategyId: id, requestKey: input.request_key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException("STRATEGY_IDEMPOTENCY_CONFLICT");
        return kind === "approve" ? this.approvalReceipt(tx, merchantId, previous.id, previous.result) : previous.result;
      }
      // This strategy's financial execution keeps its exact version and source
      // status. A communication refusal/revision must not silently stop it or
      // publish a different proposal over its immutable, lifetime budget.
      if (!incentiveAlternative && await tx.strategyIncentiveBudget.count({ where: { merchantId, strategyId: id } })) {
        throw new ConflictException("STRATEGY_INCENTIVE_ALREADY_FUNDED");
      }
      if (strategy.currentVersion !== input.version) throw new ConflictException("STRATEGY_VERSION_CONFLICT");
      const version = await tx.revenueStrategyVersion.findUniqueOrThrow({ where: { strategyId_merchantId_version: {
        strategyId: id, merchantId, version: input.version } } });
      if (version.proposalHash !== input.proposal_hash || digest(version.proposal) !== version.proposalHash) {
        throw new ConflictException("STRATEGY_PROPOSAL_CONFLICT");
      }
      if (strategy.status !== "pending_review") throw new ConflictException("STRATEGY_DECISION_CONFLICT");
      // Rejection remains possible after expiry; it never authorizes execution.
      if (kind !== "reject" && version.expiresAt <= now) throw new ConflictException("STRATEGY_PROPOSAL_EXPIRED");
      if (kind === "approve") {
        await this.unchangedRules(tx, merchantId, version.proposal as unknown as StrategyProposal);
        const approvedAt = await executionClock(tx);
        const blockers = await strategyActivationBlockers(tx, strategy, version, eligible, approvedAt);
        if (blockers.length) throw new ConflictException({ code: "STRATEGY_APPROVAL_PREREQUISITES_REQUIRED", blockers });
        const actionId = randomUUID();
        const receipt = { action_id: actionId, strategy_id: id, version: input.version,
          proposal_hash: version.proposalHash, status: "activation_pending" };
        await tx.revenueStrategyAction.create({ data: { id: actionId, strategyId: id, merchantId, version: input.version,
          requestKey: input.request_key, requestHash, actorId, kind, feedback: input.feedback, result: receipt, createdAt: approvedAt } });
        await tx.revenueStrategy.update({ where: { id }, data: { status: "activation_pending" } });
        // Receipt, reviewed plan, execution and notices either commit together or
        // roll back together. No LLM, queue or provider participates in approval.
        const execution = await registerApprovedExecution(tx, merchantId, actionId);
        await tx.revenueManagerHypothesis.updateMany({ where: { id, merchantId, status: "pending_review" }, data: {
          status: "experiment_created", merchantApprovedAt: approvedAt, merchantApprovedBy: actorId,
          merchantApprovalReason: input.feedback, createdExperimentId: execution.experimentId,
        } });
        await tx.merchantNotification.updateMany({ where: { merchantId, id: `strategy:${id}` }, data: { read: true } });
        await tx.merchantNotification.create({ data: { id: `strategy-activation:${actionId}`, merchantId,
          type: "ai_strategy_suggestion", title: "Teste da estratégia iniciado",
          body: "Acompanhe os resultados da versão aprovada no Revenue Manager.", read: false,
          metadata: { strategyId: id, hypothesisId: id, executionId: execution.id, version: input.version, state: "active" } } });
        return this.approvalReceipt(tx, merchantId, actionId, receipt);
      }
      if (kind === "revision") {
        if (!input.feedback?.trim()) throw new BadRequestException("STRATEGY_REVISION_FEEDBACK_REQUIRED");
        if (!revisionsEnabled() || !weeklyMerchantAllowed(merchantId)) throw new ServiceUnavailableException("STRATEGY_REVISIONS_UNAVAILABLE");
        let limit: number;
        try { limit = positiveInteger("REVENUE_AI_MAX_REVISIONS_PER_CYCLE"); }
        catch { throw new ServiceUnavailableException("STRATEGY_REVISION_LIMIT_REQUIRED"); }
        const count = await tx.revenueStrategyAction.count({ where: { strategyId: id, merchantId, kind: "revision" } });
        if (count >= limit) throw new ConflictException("STRATEGY_REVISION_LIMIT_REACHED");
        await this.unchangedRules(tx, merchantId, version.proposal as unknown as StrategyProposal);
        if (incentiveAlternative) {
          if (!BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.revenueManager) {
            throw new ConflictException("INCENTIVE_ALTERNATIVE_PLAN_REQUIRED");
          }
          const proposal = version.proposal as unknown as StrategyProposal;
          if (digest(proposal.incentiveRecommendation ?? null) !== incentiveAlternative.recommendationHash) {
            throw new ConflictException("INCENTIVE_ALTERNATIVE_RECOMMENDATION_CHANGED");
          }
          if (!await this.alternative(tx, merchantId, id, strategy.runId, proposal)) throw new ConflictException("INCENTIVE_ALTERNATIVE_UNAVAILABLE");
        }
      }
      const actionId = randomUUID();
      const result = { action_id: actionId, strategy_id: id, version: input.version,
        proposal_hash: version.proposalHash, status: kind === "reject" ? "rejected" : "revision_requested",
        ...(incentiveAlternative ? { revision_scope: "incentive" } : {}) };
      await tx.revenueStrategyAction.create({ data: { id: actionId, strategyId: id, merchantId, version: input.version,
        requestKey: input.request_key, requestHash, actorId, kind, feedback: input.feedback, result, createdAt: now } });
      await tx.revenueStrategy.update({ where: { id }, data: { status: kind === "reject" ? "rejected" : "revision_pending" } });
      if (kind === "revision") {
        await tx.revenueStrategyRevision.create({ data: { id: actionId, merchantId, retryAt: now } });
        await this.notice(tx, merchantId, id, actionId, "queued", input.version);
      } else await tx.revenueManagerHypothesis.updateMany({ where: { id, merchantId, status: "pending_review" },
        data: { status: "rejected", rejectionReason: input.feedback ?? "Recusada pelo lojista" } });
      await tx.merchantNotification.updateMany({ where: { merchantId, id: `strategy:${id}` }, data: { read: true } });
      return result;
    });
  }

  async dispatch(enqueue: (id: string) => Promise<void>, now = new Date()) {
    if (!revisionsEnabled()) return;
    const rows = await this.prisma.revenueStrategyRevision.findMany({ where: { retryAt: { lte: now }, OR: [
      { status: { in: ["queued", "deferred", "retry_wait"] } }, { status: "running", leaseUntil: { lte: now } },
    ] }, orderBy: [{ retryAt: "asc" }, { id: "asc" }], take: 100, select: { id: true } });
    for (const row of rows) await enqueue(row.id);
  }

  async process(id: string) {
    if (!revisionsEnabled()) return;
    const work = await this.claim(id);
    if (!work) return;
    const { action } = work;
    try {
      if (work.attempts > MAX_RUN_ATTEMPTS) throw new Error("STRATEGY_REVISION_ATTEMPT_LIMIT");
      await this.eligible(work.merchantId);
      const base = action.proposal;
      if (digest(base.proposal) !== base.proposalHash) throw new Error("STRATEGY_PROPOSAL_CORRUPT");
      if (base.expiresAt <= new Date()) throw new Error("STRATEGY_PROPOSAL_EXPIRED");
      const proposal = base.proposal as unknown as StrategyProposal;
      const sourceRun = proposal.orchestration ? await this.prisma.revenueAnalysisRun.findFirstOrThrow({
        where: { id: action.proposal.strategy.runId, merchantId: work.merchantId } }) : null;
      const incentiveOptions = sourceRun?.incentiveOptionsJson as unknown as RevenueIncentiveOptions | undefined;
      if (proposal.orchestration) await this.prisma.$transaction(tx => assertStoredStrategyOrchestration(tx,
        work.merchantId, action.proposal.strategy.runId, proposal));
      const planning = proposal.experimentReview?.planning;
      if (proposal.experimentReview) {
        assertStrategyExperimentReview(proposal.experimentReview, action.strategyId, action.version,
          proposal.recommendation, work.merchantId, action.proposal.strategy.runId);
        assertCurrentMeasurementPolicy(planning!);
      }
      const currentRules = await this.context.getRules(work.merchantId);
      if (!currentRules || digest(currentRules) !== digest(proposal.rules)) throw new Error("STRATEGY_POLICY_CHANGED");
      await this.prisma.$transaction(tx => assertStoredDiscountStudy(tx, work.merchantId,
        action.proposal.strategy.runId, proposal.observation.id, currentRules, proposal.discountStudy, proposal.incentiveRecommendation));
      const incentiveAlternative = (action.result as { revision_scope?: string }).revision_scope === "incentive"
        ? await this.prisma.$transaction(tx => this.alternative(tx, work.merchantId, action.strategyId, action.proposal.strategy.runId, proposal)) : null;
      if ((action.result as { revision_scope?: string }).revision_scope === "incentive" && !incentiveAlternative) {
        throw new Error("STRATEGY_INVALID_INCENTIVE_ALTERNATIVE");
      }
      const checkoutBaseline = await this.context.getCheckoutBaseline?.(work.merchantId);
      const baseline = checkoutBaseline ? checkoutBaselineReference(checkoutBaseline)
        : this.context.getCheckoutBaseline ? undefined : await this.context.getCurrentPrompt(work.merchantId);
      if (!baseline) throw new AnalysisDeferred("checkout_baseline_unavailable");
      if (proposal.checkoutBaseline && (!checkoutBaseline || checkoutContractHash(checkoutBaseline) !== checkoutContractHash(proposal.checkoutBaseline))) {
        throw new Error("STRATEGY_BASELINE_CHANGED");
      }
      if (baseline !== proposal.recommendation.template.variant_a.system_prompt) throw new Error("STRATEGY_BASELINE_CHANGED");
      const generatedResponse = await this.generator.generate({ merchant_id: work.merchantId,
        analysis_context: { runId: action.proposal.strategy.runId, revisionId: id, leaseToken: work.leaseToken },
        revision: { preference: action.feedback!, previous_proposal: proposal.recommendation,
          ...(incentiveAlternative?.status === "recommended" ? { incentive_alternative: {
            discount_percent: incentiveAlternative.test.discountPercent, max_discount_cents: incentiveAlternative.test.maxDiscountCents,
            limit_cents: incentiveAlternative.test.limitCents, max_redemptions: incentiveAlternative.test.maxRedemptions,
            duration_days: 7 as const, explanation: "lower_discount_same_audience" as const } } : {}) },
        observation: proposal.observation, current_prompt: baseline, checkout_baseline: checkoutBaseline,
        measurement_planning: planning, incentive_options: incentiveOptions, past_lessons: [], constraints: {
          max_discount_percent: currentRules.maxDiscountPercent, allow_free_shipping: currentRules.allowFreeShipping,
          max_running_experiments: 1, merchant_rules: currentRules } });
      const { strategy_plan: orchestration, ...generated } = generatedResponse;
      if (!!incentiveOptions !== !!orchestration) throw new Error("STRATEGY_PLANNER_DECISION_REQUIRED");
      const revisedIncentive = incentiveOptions && orchestration ? selectedIncentive(incentiveOptions, orchestration)
        : incentiveAlternative ?? proposal.incentiveRecommendation;
      if (generated.template.variant_a.system_prompt !== baseline) throw new Error("STRATEGY_BASELINE_CHANGED");
      const experimentReview = planning ? strategyExperimentReview(action.strategyId, action.version + 1, generated, planning) : undefined;
      const next = strategyProposal(generated, proposal.observation, currentRules, checkoutBaseline, experimentReview, proposal.discountStudy,
        revisedIncentive, orchestration);
      await this.eligible(work.merchantId);
      if (await this.context.getCurrentPrompt(work.merchantId) !== baseline) throw new Error("STRATEGY_BASELINE_CHANGED");
      await this.prisma.$transaction(async tx => {
        const strategy = await this.lock(tx, work.merchantId, action.strategyId);
        await tx.$queryRaw`SELECT id FROM revenue_strategy_revisions WHERE id = ${id} FOR UPDATE`;
        const owned = await tx.revenueStrategyRevision.findFirst({ where: this.fence(work) });
        if (!owned) throw new AnalysisDeferred("revision_lease_lost");
        if (strategy.status !== "revision_pending" || strategy.currentVersion !== action.version) throw new Error("STRATEGY_DECISION_CONFLICT");
        if (base.expiresAt <= new Date()) throw new Error("STRATEGY_PROPOSAL_EXPIRED");
        if (checkoutBaseline) {
          await lockCheckoutBaselineRows(tx, work.merchantId);
          const current = await readCheckoutBaseline(tx, work.merchantId);
          if (!current || checkoutContractHash(current) !== checkoutContractHash(checkoutBaseline)) throw new Error("STRATEGY_BASELINE_CHANGED");
        }
        await this.unchangedRules(tx, work.merchantId, proposal);
        if (orchestration) await assertStoredStrategyOrchestration(tx, work.merchantId, action.proposal.strategy.runId, next);
        if (planning) await assertStoredMeasurementPlanning(tx, work.merchantId, action.proposal.strategy.runId, planning);
        await assertStoredDiscountStudy(tx, work.merchantId, action.proposal.strategy.runId,
          proposal.observation.id, currentRules, proposal.discountStudy, proposal.incentiveRecommendation);
        if (incentiveAlternative) {
          const currentAlternative = await this.alternative(tx, work.merchantId, action.strategyId, action.proposal.strategy.runId, proposal);
          if (!currentAlternative || digest(currentAlternative) !== digest(incentiveAlternative)) throw new Error("STRATEGY_INVALID_INCENTIVE_ALTERNATIVE");
          await assertStoredDiscountStudy(tx, work.merchantId, action.proposal.strategy.runId,
            proposal.observation.id, currentRules, proposal.discountStudy, incentiveAlternative);
        }
        const version = action.version + 1;
        await tx.revenueStrategyVersion.create({ data: { strategyId: strategy.id, merchantId: work.merchantId, version,
          proposalHash: digest(next), proposal: json(next), expiresAt: base.expiresAt } });
        await tx.revenueStrategy.update({ where: { id: strategy.id }, data: { currentVersion: version, status: "pending_review" } });
        await tx.revenueStrategyRevision.update({ where: { id }, data: { status: "completed", reason: null, leaseUntil: null, completedAt: new Date() } });
        await this.notice(tx, work.merchantId, strategy.id, id, "revision_ready", version);
      });
    } catch (error) {
      const deferred = error instanceof AnalysisDeferred;
      const expired = action.proposal.expiresAt <= new Date();
      const permanent = expired || /STRATEGY_(POLICY_CHANGED|MEASUREMENT_POLICY_CHANGED|MEASUREMENT_CONTEXT_CHANGED|BASELINE_CHANGED|PROPOSAL_CORRUPT|INVALID|PROPOSAL_EXPIRED)/.test(String(error));
      const status = permanent || (!deferred && work.attempts >= MAX_RUN_ATTEMPTS) ? "failed" : deferred ? "deferred" : "retry_wait";
      const reason = expired ? "proposal_expired" : deferred ? error.code : permanent ? "proposal_requires_new_analysis" : "revision_generation_failed";
      await this.prisma.$transaction(async tx => {
        await this.lock(tx, work.merchantId, action.strategyId);
        const changed = await tx.revenueStrategyRevision.updateMany({ where: this.fence(work), data: { status, reason,
          leaseUntil: null, retryAt: new Date(Date.now() + 15 * 60_000), ...(deferred ? { attempts: { decrement: 1 } } : {}) } });
        if (!changed.count) return;
        if (status === "failed") await tx.revenueStrategy.updateMany({ where: { id: action.strategyId, merchantId: work.merchantId,
          status: "revision_pending", currentVersion: action.version }, data: { status: "pending_review" } });
        await this.notice(tx, work.merchantId, action.strategyId, id, status, action.version);
      });
    }
  }

  private async claim(id: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM revenue_strategy_revisions WHERE id = ${id} FOR UPDATE`;
      const row = await tx.revenueStrategyRevision.findUnique({ where: { id }, include: { action: { include: { proposal: { include: { strategy: true } } } } } });
      const now = new Date();
      if (!row || ["completed", "failed"].includes(row.status) || row.retryAt > now
        || (row.status === "running" && row.leaseUntil && row.leaseUntil > now)) return null;
      return tx.revenueStrategyRevision.update({ where: { id }, data: { status: "running", reason: null,
        attempts: { increment: 1 }, leaseToken: { increment: 1 }, leaseUntil: new Date(now.getTime() + LEASE_MS) },
        include: { action: { include: { proposal: { include: { strategy: true } } } } } });
    });
  }

  private fence(work: { id: string; merchantId: string; leaseToken: number }) {
    return { id: work.id, merchantId: work.merchantId, leaseToken: work.leaseToken, status: "running", leaseUntil: { gt: new Date() } };
  }
  private async approvalReceipt(tx: Prisma.TransactionClient, merchantId: string, actionId: string, receipt: Prisma.JsonValue) {
    const execution = await tx.strategyExecution.findFirst({ where: { merchantId, approvalActionId: actionId } });
    if (!execution) throw new ConflictException("STRATEGY_APPROVAL_EXECUTION_MISSING");
    // A historical receipt, including after a later stop. Current status is read
    // separately; replay never resumes or extends an execution.
    return { ...(receipt as Record<string, unknown>), status: "active", execution_id: execution.id,
      experiment_id: execution.experimentId, started_at: execution.startedAt.toISOString(), ends_at: execution.endsAt.toISOString() };
  }
  private async lock(tx: Prisma.TransactionClient, merchantId: string, id: string) {
    await lockCheckoutBaselineRows(tx, merchantId);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM revenue_strategies WHERE id = ${id} AND merchant_id = ${merchantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("STRATEGY_NOT_FOUND");
    return tx.revenueStrategy.findFirstOrThrow({ where: { id, merchantId } });
  }
  private async unchangedRules(tx: Prisma.TransactionClient, merchantId: string, proposal: StrategyProposal) {
    await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id = ${merchantId} FOR SHARE`;
    const row = await tx.merchantRule.findUnique({ where: { merchantId } });
    if (!row || digest(merchantRulesSnapshot(row)) !== digest(proposal.rules)) throw new ConflictException("STRATEGY_POLICY_CHANGED");
  }
  private async eligible(merchantId: string) {
    if (!revisionsEnabled() || !weeklyMerchantAllowed(merchantId)) throw new AnalysisDeferred("revision_disabled");
    if (!BILLING_PLANS[await this.billing.getEffectivePlan(merchantId)].features.revenueManager) throw new AnalysisDeferred("merchant_ineligible");
  }
  private async alternative(tx: Prisma.TransactionClient, merchantId: string, strategyId: string, runId: string,
    proposal: StrategyProposal): Promise<StrategyIncentiveRecommendation | null> {
    if (proposal.orchestration) return null;
    const recommendation = proposal.incentiveRecommendation;
    if (!recommendation || recommendation.status !== "recommended" || !proposal.discountStudy) return null;
    await assertStoredDiscountStudy(tx, merchantId, runId, proposal.observation.id, proposal.rules, proposal.discountStudy, recommendation);
    const run = await tx.revenueAnalysisRun.findFirstOrThrow({ where: { id: runId, merchantId } });
    if (run.status !== "completed") return null;
    const currentRules = await tx.merchantRule.findUnique({ where: { merchantId } });
    if (!currentRules || digest(merchantRulesSnapshot(currentRules)) !== digest(proposal.rules)) return null;
    const policy = await readIncentivePolicy(tx, merchantId);
    if (!policy.enabled || policy.policyHash !== recommendation.financialPolicy.policyHash) return null;
    const reviews = await tx.strategyIncentiveReview.findMany({ where: { merchantId, strategyId }, orderBy: { sequence: "desc" } });
    const latest = new Map<number, typeof reviews[number]>();
    for (const review of reviews) if (!latest.has(review.version)) latest.set(review.version, review);
    if ([...latest.values()].some(review => review.kind === "approve")) return null;
    // A funded strategy owns one immutable budget/execution for its lifetime.
    // Closing it stops new offers; it does not free this cycle for a second test.
    if (await tx.strategyIncentiveBudget.count({ where: { merchantId, strategyId } })) return null;
    return conservativeIncentiveAlternative(run.incentiveRecommendationJson as unknown as StrategyIncentiveRecommendation,
      (recommendation.alternative?.sequence ?? 0) + 1);
  }
  private async notice(tx: Prisma.TransactionClient, merchantId: string, strategyId: string, revisionId: string, state: string, version: number) {
    const data = { title: state === "revision_ready" ? "Nova versão da estratégia para revisar" : "Revisão da estratégia aguardando atualização",
      body: "Veja os detalhes e o histórico no Revenue Manager.", read: false,
      metadata: { strategyId, hypothesisId: strategyId, revisionId, state, version } };
    // Repeated quota/baseline waits keep one notice and do not mark it unread again.
    const prior = await tx.merchantNotification.findUnique({ where: { id: `strategy-revision:${revisionId}` } });
    if (prior && (prior.metadata as { state?: string })?.state === state) return;
    await tx.merchantNotification.upsert({ where: { id: `strategy-revision:${revisionId}` }, update: data,
      create: { ...data, id: `strategy-revision:${revisionId}`, merchantId, type: "ai_strategy_suggestion" } });
  }
  private validate(input: StrategyReviewCommand) {
    if (!Number.isSafeInteger(input.version) || input.version < 1 || typeof input.proposal_hash !== "string" || !/^[a-f0-9]{64}$/.test(input.proposal_hash)
      || typeof input.request_key !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.request_key) || (input.feedback !== undefined
        && (typeof input.feedback !== "string" || input.feedback.length > 2000))) throw new BadRequestException("STRATEGY_INVALID_REVIEW");
  }
}

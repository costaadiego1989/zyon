import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { discountStudy } from "../domain/strategy-discount-study.js";
import { plannedIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { recommendedIncentiveBudgetTerms } from "../domain/incentive-budget.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import type { HypothesisGenerationRequest } from "../domain/ports/hypothesis-generator.port.js";
import { PrismaObservationRepository } from "../infrastructure/prisma-observation.repository.js";
import { PrismaHypothesisRepository } from "../infrastructure/prisma-hypothesis.repository.js";
import { merchantRulesSnapshot, PrismaHypothesisMerchantContext } from "../infrastructure/hypothesis-merchant-context.adapter.js";
import { registerReviewedIncentiveBudget } from "../infrastructure/incentive-budget-ledger.js";
import { RevenueAiBudgetService } from "../infrastructure/revenue-ai-budget.service.js";
import { LLMHypothesisGenerator } from "../infrastructure/hypothesis-generator.adapter.js";
import { IncentivePolicyService } from "./incentive-policy.service.js";
import { IncentiveReviewService } from "./incentive-review.service.js";
import { StrategyReviewService } from "./strategy-review.service.js";
import { IncentiveMetricsService } from "./incentive-metrics.service.js";
import { WeeklyAnalysisService } from "../infrastructure/weekly-analysis.service.js";

// Only this disposable database may be reset. Run sequentially with its other suites.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, transactionOptions: { maxWait: 10000, timeout: 30000 } });
const env = { ...process.env }, billing = { getEffectivePlan: async () => "scale" };
const context = new PrismaHypothesisMerchantContext(prisma);
const reviews = new IncentiveReviewService(prisma, billing as never);
const baseline = "Explique os dados verificados.";
const response = () => ({ hypothesis_text: "Testar uma explicação das etapas", reasoning: "Comparar as sessões observadas", expected_lift_percent: 1,
  template: { name: "Explicação", description: "Explicar as próximas etapas",
    variant_a: { name: "Controle", system_prompt: baseline, weight: 50, is_control: true },
    variant_b: { name: "Teste", system_prompt: "Pergunte qual etapa precisa de explicação.", weight: 50, is_control: false } } });
const service = (generate = async (_request: HypothesisGenerationRequest) => response(), client = prisma) => new StrategyReviewService(client,
  { getRules: id => context.getRules(id), getCurrentPrompt: async () => baseline }, { generate }, billing as never);
const spec = (name: string, fn: () => Promise<void>) => test(`financial alternative ${name}`, { skip: !enabled }, fn);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { process.env = env; await prisma.$disconnect(); });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*", REVENUE_STRATEGY_REVISIONS_ENABLED: "true",
    REVENUE_AI_MAX_REVISIONS_PER_CYCLE: "3", REVENUE_INCENTIVE_BUDGET_ENABLED: "true", REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS: "store,other",
    REVENUE_INCENTIVE_REVIEW_ENABLED: "true", REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS: "store,other",
    REVENUE_INCENTIVE_EXECUTION_ENABLED: "false", REVENUE_DISCOUNT_STUDY_ENABLED: "false", REVENUE_STRATEGY_MEASUREMENT_ENABLED: "false" };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_analysis_runs, revenue_analysis_schedules,
    revenue_ai_reservations, ai_usage_events, ai_price_versions, revenue_manager_hypotheses, revenue_manager_observations,
    merchant_notifications, merchant_rules, checkout_settings, merchants, checkout_sessions, completed_orders, prompt_experiments, coupons CASCADE`);
});
async function fixture(merchantId = "store") {
  const now = new Date();
  await prisma.merchant.create({ data: { id: merchantId, name: "Fixture" } });
  const policy = await new IncentivePolicyService(prisma).save(merchantId, "owner", { expectedVersion: 0, requestKey: "policy-initial",
    enabled: true, limitCents: 500000, maxDiscountCents: 500, maxRedemptions: 1000 });
  const rules = merchantRulesSnapshot(await prisma.merchantRule.create({ data: { merchantId, maxDiscountPercent: 5, minimumMarginPercent: 30,
    allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
    couponBoxEnabled: true, autonomousEngineEnabled: true, freeShippingMinCartValue: 200, maxShippingSubsidy: 0,
    maxPartialShippingDiscount: 0, offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative" } }));
  const observation = ObservationEntity.create({ merchant_id: merchantId, observation_window_start: new Date(now.getTime() - 28 * 86400000), observation_window_end: now,
    funnel: { total_sessions: 100, started_checkout: 100, reached_shipping: 80, reached_payment: 40, completed_order: 10, conversion_rate: .1 },
    abandonment: { abandoned_at_shipping: 40, abandoned_at_payment: 30, abandonment_rate: .9, top_abandonment_objection: "unknown" },
    objections: { shipping_cost_count: 0, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 90 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { new_customers_rate: 1, returning_customers_rate: 0, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_orders: 10, total_revenue_cents: 100000, avg_order_value_cents: 10000 }, ai_costs_cents: 0 });
  await new PrismaObservationRepository(prisma).save(observation);
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId, cycle: 1, status: "running", leaseToken: 1,
    leaseUntil: new Date(now.getTime() + 600000), observationId: observation.id, asOf: now } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId, group: 0, nextDueAt: now, currentRunId: run.id } });
  const study = discountStudy({ merchantId, runId: run.id, observationId: observation.id, rules, asOf: now.toISOString(), capturedAt: now.toISOString(),
    cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .01, carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL",
      items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
  const recommendation = plannedIncentiveRecommendation(study, rules, policy, { buyers: 10000, conversions: 10, complete: true,
    windowStart: new Date(now.getTime() - 35 * 86400000).toISOString(), windowEnd: new Date(now.getTime() - 7 * 86400000).toISOString() });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { discountStudyJson: study,
    incentiveRecommendationJson: recommendation as unknown as Prisma.InputJsonValue } });
  const hypothesis = HypothesisEntity.create({ merchant_id: merchantId, observation_id: observation.id, ...response(), risk_level: "low", approval_strategy: "manual" });
  await new PrismaHypothesisRepository(prisma).save(hypothesis, { runId: run.id, leaseToken: 1, discountStudy: study });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { status: "completed" } });
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: hypothesis.id } });
  const input = { version: 1, proposal_hash: version.proposalHash, recommendation_hash: digest(recommendation), request_key: "alternative-1" };
  return { merchantId, run, study, rules, policy, recommendation, version, id: hypothesis.id, input };
}

spec("publishes a lower budget in a new version requiring new review and preserves the frozen weekly evidence", async () => {
  const f = await fixture(); let calls = 0;
  const s = service(async request => { calls++; assert.equal(request.analysis_context!.runId, f.run.id);
    assert.deepEqual(request.revision!.incentive_alternative, { discount_percent: 2.5, max_discount_cents: 250,
      limit_cents: 250000, max_redemptions: 1000, duration_days: 7, explanation: "lower_discount_same_audience" });
    return response(); });
  await reviews.decide("store", "owner", f.id, "reject", { ...f.input, request_key: "reject-primary" });
  assert.equal((await s.read("store", f.id)).incentive_alternative_available, true);
  const receipt = await s.requestIncentiveAlternative("store", "owner", f.id, f.input) as any;
  assert.equal(receipt.revision_scope, "incentive"); assert.equal(await prisma.revenueAnalysisRun.count(), 1);
  await s.process(receipt.action_id);
  const read = await s.read("store", f.id), latest = read.versions[0], proposal = latest.proposal as any;
  assert.equal(read.currentVersion, 2); assert.equal(calls, 1);
  assert.equal(latest.expiresAt.toISOString(), f.version.expiresAt.toISOString());
  assert.deepEqual(proposal.discountStudy, f.study); assert.equal(proposal.incentiveRecommendation.test.discountPercent, 2.5);
  assert.deepEqual((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } })).incentiveRecommendationJson, f.recommendation);
  const review = await reviews.read("store", f.id);
  assert.equal(review.status, "awaiting_review"); assert.equal(review.approval_available, true); assert.equal(review.history.length, 1);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0); assert.equal(await prisma.coupon.count(), 0);
  await assert.rejects(reviews.decide("store", "owner", f.id, "approve", { ...f.input, request_key: "stale-approve" }), /PROPOSAL_CHANGED|DECISION_CONFLICT/);
  await reviews.decide("store", "owner", f.id, "approve", { version: 2, proposal_hash: latest.proposalHash,
    recommendation_hash: digest(proposal.incentiveRecommendation), request_key: "approve-alternative" });
  const terms = recommendedIncentiveBudgetTerms({ merchantId: "store", strategyId: f.id, version: 2, proposalHash: latest.proposalHash,
    study: f.study, rules: f.rules, policy: f.policy, recommendation: proposal.incentiveRecommendation }, new Date(Date.now() + 10000).toISOString());
  const budget = await prisma.$transaction(tx => registerReviewedIncentiveBudget(tx, { merchantId: "store", terms, termsHash: digest(terms), actorId: "owner", requestKey: "fund-alternative" }));
  assert.equal(budget.limitCents, 250000); assert.equal((await s.read("store", f.id)).incentive_alternative_available, false);
  const nextInput = { version: 2, proposal_hash: latest.proposalHash,
    recommendation_hash: digest(proposal.incentiveRecommendation), request_key: "withdraw-funded" };
  await reviews.decide("store", "owner", f.id, "withdraw", nextInput);
  assert.equal((await s.read("store", f.id)).incentive_alternative_available, false);
  await assert.rejects(s.requestIncentiveAlternative("store", "owner", f.id, { ...nextInput, request_key: "alternative-after-funding" }), /ALTERNATIVE_UNAVAILABLE/);
});

spec("serializes duplicate requests and never repeats a published version on receipt replay", async () => {
  const f = await fixture(), s = service();
  const receipts = await Promise.all(Array.from({ length: 4 }, () => s.requestIncentiveAlternative("store", "owner", f.id, f.input))) as any[];
  assert.ok(receipts.every(receipt => digest(receipt) === digest(receipts[0])));
  assert.equal(await prisma.revenueStrategyRevision.count(), 1);
  await s.process(receipts[0].action_id);
  assert.deepEqual(await s.requestIncentiveAlternative("store", "owner", f.id, f.input), receipts[0]);
  await assert.rejects(s.requestIncentiveAlternative("store", "owner", f.id, { ...f.input, feedback: "different" }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(s.requestIncentiveAlternative("other", "owner", f.id, f.input), /NOT_FOUND/);
  assert.equal(await prisma.revenueStrategyVersion.count(), 2);
});

spec("approval racing an alternative request has one winner and never reuses prior consent", async () => {
  const f = await fixture(), s = service();
  const outcomes = await Promise.allSettled([
    reviews.decide("store", "owner", f.id, "approve", { ...f.input, request_key: "approve-race" }),
    s.requestIncentiveAlternative("store", "owner", f.id, f.input),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(await prisma.strategyIncentiveReview.count() + await prisma.revenueStrategyRevision.count(), 1);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("shares revision limits and refuses stale hashes, disabled generation and plan downgrade", async () => {
  const f = await fixture(), s = service();
  await assert.rejects(s.requestIncentiveAlternative("store", "owner", f.id, { ...f.input, recommendation_hash: "f".repeat(64) }), /RECOMMENDATION_CHANGED/);
  const downgraded = new StrategyReviewService(prisma, context, { generate: async () => response() }, { getEffectivePlan: async () => "starter" } as never);
  await assert.rejects(downgraded.requestIncentiveAlternative("store", "owner", f.id, f.input), /PLAN_REQUIRED/);
  process.env.REVENUE_STRATEGY_REVISIONS_ENABLED = "false";
  await assert.rejects(s.requestIncentiveAlternative("store", "owner", f.id, f.input), /REVISIONS_UNAVAILABLE/);
  process.env.REVENUE_STRATEGY_REVISIONS_ENABLED = "true";
  process.env.REVENUE_AI_MAX_REVISIONS_PER_CYCLE = "1";
  const receipt = await s.requestIncentiveAlternative("store", "owner", f.id, f.input) as any;
  await s.process(receipt.action_id);
  const latest = (await s.read("store", f.id)).versions[0];
  await assert.rejects(s.requestIncentiveAlternative("store", "owner", f.id, { ...f.input, version: 2, proposal_hash: latest.proposalHash,
    recommendation_hash: digest((latest.proposal as any).incentiveRecommendation), request_key: "alternative-2" }), /REVISION_LIMIT_REACHED/);
  assert.equal(await prisma.revenueStrategyRevision.count(), 1);
});

spec("requires withdrawal of a prior incentive approval and cannot silently replace an active decision", async () => {
  const f = await fixture(), s = service();
  await reviews.decide("store", "owner", f.id, "approve", { ...f.input, request_key: "approve-primary" });
  assert.equal((await s.read("store", f.id)).incentive_alternative_available, false);
  await assert.rejects(s.requestIncentiveAlternative("store", "owner", f.id, f.input), /ALTERNATIVE_UNAVAILABLE/);
  assert.equal(await prisma.revenueStrategyRevision.count(), 0);
  await reviews.decide("store", "owner", f.id, "withdraw", { ...f.input, request_key: "withdraw-primary" });
  const receipt = await s.requestIncentiveAlternative("store", "owner", f.id, f.input) as any;
  await s.process(receipt.action_id);
  assert.equal((await reviews.read("store", f.id)).status, "awaiting_review");
  assert.equal(await prisma.strategyIncentiveReview.count(), 2);
});

spec("funded incentive cannot be stopped or superseded by communication decisions", async () => {
  const f = await fixture(), s = service();
  Object.assign(process.env, { REVENUE_INCENTIVE_EXECUTION_ENABLED: "true", REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: "store" });
  await reviews.decide("store", "owner", f.id, "approve", { ...f.input, request_key: "activate-incentive" });
  let current = await s.read("store", f.id);
  assert.equal(current.status, "pending_review"); assert.equal(current.decision_available, false);
  assert.equal(current.revision_available, false); assert.equal(current.approval_available, false);
  assert.ok(current.activation_blockers.includes("incentive_already_funded"));
  const command = { version: 1, proposal_hash: f.version.proposalHash, request_key: "communication-review", feedback: "Explique as etapas" };
  for (const kind of ["approve", "reject", "revision"] as const) {
    await assert.rejects(s.decide("store", "owner", f.id, kind, command), /STRATEGY_INCENTIVE_ALREADY_FUNDED/);
  }
  assert.equal(await prisma.revenueStrategyAction.count(), 0);
  assert.equal(await prisma.revenueStrategyRevision.count(), 0);
  assert.equal((await new IncentiveMetricsService(prisma).read("store", f.id, 1)).execution !== null, true);
  assert.equal((await reviews.read("store", f.id)).withdrawal_available, true);
  await reviews.decide("store", "owner", f.id, "withdraw", { ...f.input, request_key: "stop-incentive" });
  current = await s.read("store", f.id);
  assert.equal(current.decision_available, false); assert.equal(current.revision_available, false);
  await assert.rejects(s.decide("store", "owner", f.id, "revision", command), /STRATEGY_INCENTIVE_ALREADY_FUNDED/);
  assert.equal((await reviews.read("store", f.id)).execution_status, "withdrawn");
  assert.equal((await prisma.revenueStrategy.findUniqueOrThrow({ where: { id: f.id } })).status, "pending_review");
  assert.equal(await prisma.revenueStrategyVersion.count(), 1);
});

spec("weekly generation waits for an open incentive even after the proposal approval deadline", async () => {
  const f = await fixture();
  Object.assign(process.env, { REVENUE_INCENTIVE_EXECUTION_ENABLED: "true", REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: "store",
    REVENUE_WEEKLY_GENERATION_ENABLED: "true" });
  await reviews.decide("store", "owner", f.id, "approve", { ...f.input, request_key: "activate-incentive" });
  const execution = await prisma.strategyIncentiveExecution.findFirstOrThrow({ where: { merchantId: "store", strategyId: f.id } });
  // Approval starts its seven-day horizon after the proposal was captured. This
  // clock is beyond proposal expiry but still inside the actual execution.
  const analysisTime = new Date(f.version.expiresAt.getTime() + 1);
  assert.ok(analysisTime < execution.endsAt);
  let calls = 0;
  const weekly = new WeeklyAnalysisService(prisma, billing as never, { execute: async () => { throw new Error("observation already captured"); } } as never,
    { execute: async () => { calls++; return { hypothesis_id: f.id }; } } as never);
  weekly.clock = () => analysisTime;
  assert.equal(await weekly.pendingDecisions("store", analysisTime), 0);
  const createRun = (cycle: number) => prisma.revenueAnalysisRun.create({ data: { merchantId: "store", cycle, status: "running", leaseToken: 1,
    leaseUntil: new Date(analysisTime.getTime() + 600000), asOf: analysisTime, observationId: f.run.observationId } });
  const run = await createRun(2);
  weekly.claim = async () => run;
  await weekly.process(run.id);
  const completed = await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(completed.status, "completed"); assert.equal(completed.result, "keep_current"); assert.equal(calls, 0);
  await reviews.decide("store", "owner", f.id, "withdraw", { ...f.input, request_key: "withdraw-incentive" });
  const following = await createRun(3);
  weekly.claim = async () => following;
  await weekly.process(following.id);
  assert.equal(calls, 1);
  assert.equal((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: following.id } })).result, "recommendations");
});

spec("does not call a provider above the original cycle daily AI ceiling", async () => {
  const f = await fixture();
  Object.assign(process.env, { OPENAI_API_KEY: "fixture-only", OPENAI_MODEL: "fixture", REVENUE_AI_MAX_INPUT_TOKENS: "20000",
    REVENUE_AI_MAX_OUTPUT_TOKENS: "1000", REVENUE_AI_DAILY_LIMIT_MICROS: "1", REVENUE_AI_MONTHLY_LIMIT_MICROS: "50000",
    REVENUE_AI_CYCLE_LIMIT_MICROS: "50000", REVENUE_AI_MAX_CALLS_PER_CYCLE: "2", REVENUE_AI_PROVIDER_RPM: "100",
    REVENUE_AI_PROVIDER_TPM: "1000000", REVENUE_AI_PROVIDER_CONCURRENCY: "10", REVENUE_AI_REVISION_RESERVE_PERCENT: "50", REVENUE_AI_BUDGET_CURRENCY: "USD" });
  delete process.env.DEEPSEEK_API_KEY;
  await prisma.aiPriceVersion.create({ data: { version: "fixture", provider: "openai", model: "fixture", channel: "chat",
    component: "text_generation", source: "revenue-upper-bound-v1", inputMicrosPerMillion: 1000000n,
    outputMicrosPerMillion: 1000000n, currency: "USD", effectiveFrom: new Date("2026-01-01") } });
  const generator = new LLMHypothesisGenerator(new RevenueAiBudgetService(prisma));
  const s = service(request => generator.generate(request));
  const oldFetch = globalThis.fetch; let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error("must not call provider"); }) as typeof fetch;
  try {
    const receipt = await s.requestIncentiveAlternative("store", "owner", f.id, f.input) as any;
    await s.process(receipt.action_id);
    const work = await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } });
    assert.equal(work.status, "deferred"); assert.equal(work.reason, "budget_exhausted"); assert.equal(providerCalls, 0);
    assert.equal(await prisma.revenueAnalysisRun.count(), 1); assert.equal(await prisma.revenueStrategyVersion.count(), 1);
  } finally { globalThis.fetch = oldFetch; }
});

spec("rolls back the task and decision if the notification cannot persist", async () => {
  const f = await fixture();
  const broken = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (fn: any) => target.$transaction(tx => fn(new Proxy(tx, { get(inner, field) {
      if (field === "merchantNotification") return { findUnique: async () => null, upsert: async () => { throw new Error("notice unavailable"); } };
      return Reflect.get(inner, field);
    } })));
  } });
  await assert.rejects(service(undefined, broken).requestIncentiveAlternative("store", "owner", f.id, f.input), /notice unavailable/);
  assert.equal(await prisma.revenueStrategyAction.count(), 0); assert.equal(await prisma.revenueStrategyRevision.count(), 0);
  assert.equal((await prisma.revenueStrategy.findUniqueOrThrow({ where: { id: f.id } })).status, "pending_review");
});

spec("refuses changed financial policy after generation without publishing or spending", async () => {
  const f = await fixture();
  const s = service(async () => {
    await new IncentivePolicyService(prisma).save("store", "owner", { expectedVersion: 1, requestKey: "changed-policy", enabled: true,
      limitCents: 400000, maxDiscountCents: 400, maxRedemptions: 1000 });
    return response();
  });
  const receipt = await s.requestIncentiveAlternative("store", "owner", f.id, f.input) as any;
  await s.process(receipt.action_id);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: receipt.action_id } })).status, "failed");
  assert.equal(await prisma.revenueStrategyVersion.count(), 1); assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("database accepts only canonical reductions and rejects injected caps or audiences", async () => {
  const f = await fixture(), s = service();
  const receipt = await s.requestIncentiveAlternative("store", "owner", f.id, f.input) as any;
  await s.process(receipt.action_id);
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: f.id, version: 2 } });
  const next = (version.proposal as any).incentiveRecommendation;
  for (const [value, expected] of [[next, true], [{ ...next, test: { ...next.test, maxDiscountCents: 501 } }, false],
    [{ ...next, test: { ...next.test, audience: { ...next.test.audience, consent: "optional" } } }, false],
    [{ ...next, alternative: { ...next.alternative, sequence: 1.5 } }, false]] as const) {
    const [row] = await prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT incentive_recommendation_matches_frozen(${JSON.stringify(value)}::jsonb, ${JSON.stringify(f.recommendation)}::jsonb) AS valid`;
    assert.equal(row.valid, expected);
  }
});

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { discountStudy } from "../domain/strategy-discount-study.js";
import { incentiveBudgetTerms, recommendedIncentiveBudgetTerms } from "../domain/incentive-budget.js";
import { incentiveRecommendation, plannedIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { IncentivePolicyService } from "../application/incentive-policy.service.js";
import { IncentiveReviewService } from "../application/incentive-review.service.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import { PrismaHypothesisRepository } from "./prisma-hypothesis.repository.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { registerReviewedIncentiveBudget, reserveIncentiveBudget, resolveIncentiveBudget,
  closeIncentiveBudget, readIncentiveBudget } from "./incentive-budget-ledger.js";

// Shared disposable review database: never run concurrently with its other suites.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, transactionOptions: { maxWait: 10000, timeout: 30000 } });
const env = { ...process.env };
const reviews = new IncentiveReviewService(prisma, { getEffectivePlan: async () => "scale" } as never);
const tx = <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work);
const spec = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled }, fn);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { process.env = env; await prisma.$disconnect(); });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*",
    REVENUE_INCENTIVE_BUDGET_ENABLED: "true", REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS: "store,other",
    REVENUE_INCENTIVE_REVIEW_ENABLED: "true", REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS: "store,other",
    REVENUE_DISCOUNT_STUDY_ENABLED: "false", REVENUE_STRATEGY_MEASUREMENT_ENABLED: "false" };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_analysis_runs, revenue_analysis_schedules,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, checkout_settings,
    merchants, checkout_sessions, completed_orders, prompt_experiments, coupons CASCADE`);
});

const defaultCaps = { limitCents: 500000, maxDiscountCents: 500, maxRedemptions: 1000 };
async function fixture(merchantId = "store", caps = defaultCaps, mode: "planned" | "legacy" | "missing" | "blocked" = "planned", reviewed = true, ageMs = 0) {
  const now = new Date();
  const asOf = new Date(now.getTime() - ageMs);
  await prisma.merchant.create({ data: { id: merchantId, name: "Fixture" } });
  const policy = await new IncentivePolicyService(prisma).save(merchantId, "owner", {
    expectedVersion: 0, requestKey: "policy-first", enabled: true, ...caps });
  const rules = merchantRulesSnapshot(await prisma.merchantRule.create({ data: { merchantId,
    maxDiscountPercent: 5, minimumMarginPercent: 30, allowFreeShipping: false, allowShippingDiscount: false,
    allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: true, autonomousEngineEnabled: true,
    freeShippingMinCartValue: 200, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0, offerExpirationMinutes: 15,
    blockedRegions: [], brandVoice: "consultative" } }));
  const observation = ObservationEntity.create({ merchant_id: merchantId,
    observation_window_start: new Date(asOf.getTime() - 28 * 86400000), observation_window_end: asOf,
    funnel: { total_sessions: 100, started_checkout: 100, reached_shipping: 80, reached_payment: 40, completed_order: 10, conversion_rate: .1 },
    abandonment: { abandoned_at_shipping: 40, abandoned_at_payment: 30, abandonment_rate: .9, top_abandonment_objection: "unknown" },
    objections: { shipping_cost_count: 0, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 90 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { new_customers_rate: 1, returning_customers_rate: 0, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_orders: 10, total_revenue_cents: 100000, avg_order_value_cents: 10000 }, ai_costs_cents: 0 });
  await new PrismaObservationRepository(prisma).save(observation);
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId, cycle: 1, status: "running", leaseToken: 1,
    leaseUntil: new Date(now.getTime() + 600000), observationId: observation.id, asOf } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId, group: 0, nextDueAt: now, currentRunId: run.id } });
  const study = discountStudy({ merchantId, runId: run.id, observationId: observation.id, rules,
    asOf: asOf.toISOString(), capturedAt: now.toISOString(), cohorts: [{ intent: "price_sensitive", sampleSize: 10000, conversionRate: .001,
      carts: Array.from({ length: 10000 }, () => ({ total: 100, currency: "BRL", items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
  const recommendation = mode === "missing" ? undefined : mode === "legacy" ? incentiveRecommendation(study, rules, policy)
    : plannedIncentiveRecommendation(study, rules, policy, { buyers: mode === "blocked" ? 1000 : 10000,
      conversions: mode === "blocked" ? 100 : 10, complete: true,
      windowStart: new Date(asOf.getTime() - 35 * 86400000).toISOString(), windowEnd: new Date(asOf.getTime() - 7 * 86400000).toISOString() });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { discountStudyJson: study,
    ...(recommendation ? { incentiveRecommendationJson: recommendation as unknown as Prisma.InputJsonValue } : {}) } });
  const hypothesis = HypothesisEntity.create({ merchant_id: merchantId, observation_id: observation.id,
    hypothesis_text: "Testar uma explicação das etapas", reasoning: "Comparar as sessões observadas", expected_lift_percent: 1,
    template: { name: "Explicação", description: "Explicar as próximas etapas",
      variant_a: { name: "Controle", system_prompt: "Explique os dados verificados.", weight: 50, is_control: true },
      variant_b: { name: "Teste", system_prompt: "Pergunte qual etapa precisa de explicação.", weight: 50, is_control: false } },
    risk_level: "low", approval_strategy: "manual" });
  await new PrismaHypothesisRepository(prisma).save(hypothesis, { runId: run.id, leaseToken: 1, discountStudy: study });
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: hypothesis.id } });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { status: "completed" } });
  const source = { merchantId, strategyId: hypothesis.id, version: 1, proposalHash: version.proposalHash, study, rules, policy, recommendation };
  const reviewCommand = { version: 1, proposal_hash: version.proposalHash, recommendation_hash: digest(recommendation ?? null), request_key: "specific-review" };
  const review = reviewed && mode === "planned" ? await reviews.decide(merchantId, "owner", hypothesis.id, "approve", reviewCommand) : null;
  const startsAt = new Date(Date.now() + 2_000).toISOString();
  const terms = mode === "planned" ? recommendedIncentiveBudgetTerms(source, startsAt) : incentiveBudgetTerms(source, { ...caps, startsAt });
  const input = { merchantId, terms, termsHash: digest(terms), actorId: "owner", requestKey: "budget-review" };
  return { merchantId, input, terms, version, run, hypothesis, source, reviewCommand, review };
}
async function ready(caps?: { limitCents: number; maxDiscountCents: number; maxRedemptions: number }) {
  const f = await fixture("store", caps);
  const budget = await tx(t => registerReviewedIncentiveBudget(t, f.input));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, budget.startsAt.getTime() - Date.now() + 5)));
  return { ...f, budget };
}
async function session(merchantId = "store", sessionId = randomUUID(), buyerId = sessionId, cohort = "treatment", currency = "BRL") {
  const now = new Date();
  await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerId, conversationId: sessionId,
    cart: { currency, total: 100 }, cohort, createdAt: now, updatedAt: now } });
  return { merchantId, sessionId, buyerId };
}
async function reserve(f: Awaited<ReturnType<typeof ready>>, amountCents = 500, requestKey = randomUUID(), buyer?: Awaited<ReturnType<typeof session>>) {
  const input = { ...(buyer ?? await session()), budgetId: f.budget.id, amountCents, requestKey };
  return { input, row: await tx(t => reserveIncentiveBudget(t, input)) };
}
const totals = (f: Awaited<ReturnType<typeof ready>>) => tx(t => readIncentiveBudget(t, f.merchantId, f.budget.id));
const resolution = (id: string, status: "spent" | "released" = "spent", spentCents = 500) => ({
  merchantId: "store", reservationId: id, status, spentCents, evidenceKey: `commerce:${id}` });

// Fill via actual reservation evidence; never fabricate counters or disable a
// guard. Leave a small remainder to exercise concurrent exhaustion efficiently.
async function fill(f: Awaited<ReturnType<typeof ready>>, count: number, amountCents = 500) {
  const now = new Date();
  const buyers = Array.from({ length: count }, () => randomUUID());
  await prisma.checkoutSession.createMany({ data: buyers.map(id => ({ merchantId: f.merchantId, sessionId: id,
    globalUserId: id, conversationId: id, cohort: "treatment", cart: { currency: "BRL", total: 100 }, createdAt: now, updatedAt: now })) });
  await prisma.strategyIncentiveReservation.createMany({ data: buyers.map(id => ({ id, merchantId: f.merchantId,
    budgetId: f.budget.id, sessionId: id, buyerId: id, requestKey: id, requestHash: "a".repeat(64), amountCents, reservedAt: now })) });
}

function rawFunding(f: Awaited<ReturnType<typeof fixture>>, patch: Record<string, unknown> = {}) {
  const terms = { ...f.terms, startsAt: new Date(Date.now() + 60000).toISOString() };
  terms.endsAt = new Date(Date.parse(terms.startsAt) + 7 * 86400000).toISOString();
  return { id: randomUUID(), merchantId: f.merchantId, strategyId: f.hypothesis.id, version: 1,
    reviewId: f.review?.review_id,
    policyVersion: 1, proposalHash: f.version.proposalHash, terms, termsHash: digest(terms), actorId: "owner",
    requestKey: randomUUID(), requestHash: "a".repeat(64), limitCents: terms.limitCents,
    maxDiscountCents: terms.maxDiscountCents, maxRedemptions: terms.maxRedemptions,
    startsAt: new Date(terms.startsAt), endsAt: new Date(terms.endsAt), approvedAt: new Date(), ...patch };
}

spec("specific approval freezes the recommended version without activating or financing either test", async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  const before = await reviews.read("store", f.hypothesis.id);
  assert.equal(before.approval_available, true); assert.equal(before.decision, null);
  const results = await Promise.all(Array.from({ length: 6 }, () => reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand)));
  assert.equal(new Set(results.map(r => r.review_id)).size, 1);
  assert.equal(results[0].status, "approved_awaiting_activation");
  assert.equal(results[0].recommendation_hash, digest(f.source.recommendation));
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0); assert.equal(await prisma.strategyIncentiveReservation.count(), 0);
  assert.equal(await prisma.strategyExecution.count(), 0); assert.equal(await prisma.promptExperiment.count(), 0);
  assert.equal(await prisma.coupon.count(), 0); assert.equal(await prisma.revenueStrategyAction.count(), 0);
  assert.equal((await prisma.revenueStrategy.findUniqueOrThrow({ where: { id: f.hypothesis.id } })).status, "pending_review");
  assert.equal(await prisma.merchantNotification.count({ where: { id: { startsWith: "strategy-incentive-review:" } } }), 1);
  const detail = await reviews.read("store", f.hypothesis.id);
  assert.equal(detail.approval_available, false); assert.equal(detail.withdrawal_available, true);
  assert.equal(detail.budget, null); assert.equal(detail.execution_status, "unavailable");
  for (const patch of [{ request_key: "second" }, { recommendation_hash: "a".repeat(64) }, { feedback: "changed" }])
    await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", { ...f.reviewCommand, ...patch }), /CONFLICT/);
  await assert.rejects(reviews.decide("store", "another-owner", f.hypothesis.id, "approve", f.reviewCommand), /KEY_CONFLICT/);
});

spec("neither internal funding nor SQL can bypass the specific incentive approval", async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /SPECIFIC_APPROVAL_REQUIRED/);
  await assert.rejects(prisma.strategyIncentiveBudget.create({ data: rawFunding(f) }), /requires specific merchant approval/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("funding binds the approving actor and rejects an approval from another store", async () => {
  const f = await fixture();
  const other = await fixture("other");
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, actorId: "another-owner" })), /ACTOR_CHANGED/);
  for (const patch of [{ reviewId: other.review!.review_id }, { actorId: "another-owner" }])
    await assert.rejects(prisma.strategyIncentiveBudget.create({ data: rawFunding(f, patch) }), /requires specific merchant approval/);
  await assert.rejects(reviews.read("other", f.hypothesis.id), /NOT_FOUND/);
  await assert.rejects(reviews.decide("other", "owner", f.hypothesis.id, "withdraw", f.reviewCommand), /NOT_FOUND/);
});

spec("rejection remains possible without a plan or flags and cannot become approval", async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  const downgraded = new IncentiveReviewService(prisma, { getEffectivePlan: async () => { throw new Error("billing unavailable"); } } as never);
  process.env.REVENUE_INCENTIVE_REVIEW_ENABLED = "false";
  const result = await downgraded.decide("store", "owner", f.hypothesis.id, "reject", f.reviewCommand);
  assert.equal(result.status, "rejected");
  assert.deepEqual(await downgraded.decide("store", "owner", f.hypothesis.id, "reject", f.reviewCommand), result);
  process.env.REVENUE_INCENTIVE_REVIEW_ENABLED = "true";
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", { ...f.reviewCommand, request_key: "after-refusal" }), /DECISION_CONFLICT/);
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /SPECIFIC_APPROVAL_REQUIRED/);
});

spec("withdrawal atomically closes funding, preserves uncertain reserves, and allows settlement", async () => {
  const f = await ready(); const existing = await reserve(f), buyer = await session();
  const command = { ...f.reviewCommand, request_key: "withdraw" };
  process.env.REVENUE_INCENTIVE_REVIEW_ENABLED = "false";
  const stopped = new IncentiveReviewService(prisma, { getEffectivePlan: async () => { throw new Error("billing unavailable"); } } as never);
  const receipt = await stopped.decide("store", "owner", f.hypothesis.id, "withdraw", command);
  assert.equal(receipt.status, "withdrawn");
  assert.equal((await totals(f)).status, "closed"); assert.equal((await totals(f)).reservedCents, 500);
  await assert.rejects(reserve(f, 500, "after-withdrawal", buyer), /SPECIFIC_APPROVAL_REQUIRED/);
  await assert.rejects(prisma.strategyIncentiveReservation.create({ data: { id: randomUUID(), ...buyer, budgetId: f.budget.id,
    requestKey: "raw-after-withdrawal", requestHash: "a".repeat(64), amountCents: 500, reservedAt: new Date() } }), /requires specific merchant approval/);
  assert.deepEqual(await stopped.decide("store", "owner", f.hypothesis.id, "withdraw", command), receipt);
  assert.deepEqual(await stopped.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand), f.review);
  assert.equal((await reviews.read("store", f.hypothesis.id)).status, "withdrawn");
  assert.equal((await tx(t => reserveIncentiveBudget(t, existing.input))).id, existing.row.id);
  await tx(t => resolveIncentiveBudget(t, resolution(existing.row.id)));
  assert.equal((await totals(f)).spentCents, 500);
  assert.equal((await tx(t => registerReviewedIncentiveBudget(t, f.input))).id, f.budget.id);
});

for (const status of ["pending_review", "activation_pending", "active"])
spec(`specific approval stays separate when communication is ${status}`, async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { status } });
  assert.equal((await reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand)).status, "approved_awaiting_activation");
  assert.equal((await prisma.revenueStrategy.findUniqueOrThrow({ where: { id: f.hypothesis.id } })).status, status);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

for (const mode of ["legacy", "blocked"] as const)
spec(`specific approval refuses ${mode} recommendations without affecting communication`, async () => {
  const f = await fixture("store", defaultCaps, mode, false);
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand),
    (error: any) => error.getResponse()?.code === "INCENTIVE_REVIEW_PREREQUISITES_REQUIRED");
  assert.equal((await reviews.read("store", f.hypothesis.id)).approval_available, false);
  assert.equal(await prisma.strategyIncentiveReview.count(), 0);
});

for (const stop of ["flag", "allowlist", "plan", "rules", "policy", "run", "strategy", "version"])
spec(`specific approval rechecks ${stop} before recording merchant consent`, async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  let service = reviews;
  if (stop === "flag") process.env.REVENUE_INCENTIVE_REVIEW_ENABLED = "false";
  if (stop === "allowlist") process.env.REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS = "*";
  if (stop === "plan") service = new IncentiveReviewService(prisma, { getEffectivePlan: async () => "starter" } as never);
  if (stop === "rules") await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { minimumMarginPercent: 40 } });
  if (stop === "policy") await new IncentivePolicyService(prisma).save("store", "owner", { enabled: false, ...defaultCaps, expectedVersion: 1, requestKey: "stop-policy" });
  if (stop === "run") await prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data: { status: "running" } });
  if (stop === "strategy") await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { status: "rejected" } });
  if (stop === "version") await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 2 } });
  await assert.rejects(service.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand),
    (error: any) => stop === "version" ? error.message === "INCENTIVE_REVIEW_PROPOSAL_CHANGED"
      : error.getResponse()?.code === "INCENTIVE_REVIEW_PREREQUISITES_REQUIRED");
  assert.equal(await prisma.strategyIncentiveReview.count(), 0);
});

spec("approval and rejection racing accept exactly one durable decision", async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  const results = await Promise.allSettled([reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand),
    reviews.decide("store", "owner", f.hypothesis.id, "reject", { ...f.reviewCommand, request_key: "refusal-race" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.strategyIncentiveReview.count(), 1);
  assert.equal(await prisma.strategyIncentiveReviewHead.count(), 1);
});

spec("expired recommendations cannot be approved through the service or raw SQL", async () => {
  const f = await fixture("store", defaultCaps, "planned", false, 8 * 86400000);
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand),
    (error: any) => error.getResponse()?.blockers.includes("proposal_expired"));
  assert.equal((await reviews.read("store", f.hypothesis.id)).approval_available, false);
  const raw = { id: randomUUID(), merchantId: "store", strategyId: f.hypothesis.id, version: 1, sequence: 1, kind: "approve",
    proposalHash: f.version.proposalHash, recommendationHash: f.reviewCommand.recommendation_hash, policyVersion: 1,
    policyHash: f.source.policy.policyHash, actorId: "owner", requestKey: "raw-expired", requestHash: "a".repeat(64),
    createdAt: new Date(), expiresAt: f.version.expiresAt };
  await assert.rejects(prisma.strategyIncentiveReview.create({ data: raw }), /prerequisites required/);
  assert.equal((await reviews.decide("store", "owner", f.hypothesis.id, "reject", f.reviewCommand)).status, "rejected");
});

spec("new decisions require both the visible proposal hash and the incentive hash", async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  for (const patch of [{ proposal_hash: "a".repeat(64) }, { recommendation_hash: "b".repeat(64) }, { version: 9 }])
    await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", { ...f.reviewCommand, ...patch }), /CHANGED|NOT_FOUND/);
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "withdraw", f.reviewCommand), /DECISION_CONFLICT/);
  assert.equal(await prisma.strategyIncentiveReview.count(), 0);
});

spec("approval read exposes invalidation after financial policy drift without rewriting history", async () => {
  const f = await fixture();
  await new IncentivePolicyService(prisma).save("store", "owner", { enabled: true, ...defaultCaps, expectedVersion: 1, requestKey: "same-values-new-policy" });
  const detail = await reviews.read("store", f.hypothesis.id);
  assert.equal(detail.status, "approval_invalidated");
  assert.equal(detail.decision?.status, "approved_awaiting_activation");
  assert.equal(detail.withdrawal_available, true);
  assert.ok(detail.approval_blockers.includes("financial_policy_changed"));
  assert.deepEqual(await reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand), f.review);
});

spec("withdrawal and closing funding roll back as a single operation", async () => {
  const f = await ready(); const existing = await reserve(f);
  const aborting = new IncentiveReviewService({ $transaction: (work: (t: Prisma.TransactionClient) => Promise<unknown>) => tx(async t => {
    await work(t); throw new Error("rollback-withdrawal");
  }) } as never, {} as never);
  await assert.rejects(aborting.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "rollback" }), /rollback-withdrawal/);
  assert.equal(await prisma.strategyIncentiveReview.count(), 1);
  assert.equal((await prisma.strategyIncentiveReviewHead.findFirstOrThrow()).currentSequence, 1);
  assert.equal((await totals(f)).status, "open"); assert.equal((await totals(f)).reservedCents, existing.row.amountCents);
});

spec("a reserve racing withdrawal either precedes it or fails, never escapes the closed budget", async () => {
  const f = await ready(); const buyer = await session();
  const outcomes = await Promise.allSettled([reserve(f, 500, "race-with-withdrawal", buyer),
    reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "stop-race" })]);
  assert.equal(outcomes[1].status, "fulfilled");
  if (outcomes[0].status === "rejected") assert.match(String(outcomes[0].reason), /SPECIFIC_APPROVAL_REQUIRED/);
  const total = await totals(f);
  assert.equal(total.status, "closed");
  assert.equal(total.reservedCount, outcomes[0].status === "fulfilled" ? 1 : 0);
  await assert.rejects(reserve(f, 500, "too-late"), /SPECIFIC_APPROVAL_REQUIRED/);
});

for (const mode of ["legacy", "blocked"] as const)
spec(`raw SQL cannot approve a ${mode} incentive document`, async () => {
  const f = await fixture("store", defaultCaps, mode, false);
  await assert.rejects(prisma.strategyIncentiveReview.create({ data: { id: randomUUID(), merchantId: "store", strategyId: f.hypothesis.id,
    version: 1, sequence: 1, kind: "approve", proposalHash: f.version.proposalHash, recommendationHash: f.reviewCommand.recommendation_hash,
    policyVersion: 1, policyHash: f.source.policy.policyHash, actorId: "owner", requestKey: "raw-review", requestHash: "a".repeat(64),
    createdAt: new Date(), expiresAt: f.version.expiresAt } }), /prerequisites required/);
  assert.equal(await prisma.strategyIncentiveReviewHead.count(), 0);
});

spec("withdrawal is possible after supersession and policy changes; original approval stays historical", async () => {
  const f = await fixture();
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 2, status: "revision_pending" } });
  await new IncentivePolicyService(prisma).save("store", "owner", { enabled: false, ...defaultCaps, expectedVersion: 1, requestKey: "disable" });
  assert.equal((await reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "withdraw-old" })).status, "withdrawn");
  assert.deepEqual(await reviews.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand), f.review);
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "twice" }), /DECISION_CONFLICT/);
});

spec("review, review head and notification roll back together", async () => {
  const f = await fixture("store", defaultCaps, "planned", false);
  const aborting = new IncentiveReviewService({ $transaction: (work: (t: Prisma.TransactionClient) => Promise<unknown>) => tx(async t => {
    await work(t); throw new Error("rollback-review");
  }) } as never, { getEffectivePlan: async () => "scale" } as never);
  await assert.rejects(aborting.decide("store", "owner", f.hypothesis.id, "approve", f.reviewCommand), /rollback-review/);
  assert.equal(await prisma.strategyIncentiveReview.count(), 0); assert.equal(await prisma.strategyIncentiveReviewHead.count(), 0);
  assert.equal(await prisma.merchantNotification.count({ where: { id: { startsWith: "strategy-incentive-review:" } } }), 0);
});

spec("SQL keeps review receipts and heads immutable and rejects a fabricated withdrawal", async () => {
  const f = await fixture();
  await assert.rejects(prisma.strategyIncentiveReview.update({ where: { id: f.review!.review_id }, data: { kind: "reject" } }), /history is immutable/);
  await assert.rejects(prisma.strategyIncentiveReview.delete({ where: { id: f.review!.review_id } }), /history is immutable/);
  await assert.rejects(prisma.strategyIncentiveReviewHead.updateMany({ data: { currentSequence: 2 } }), /requires a decision/);
  const other = await fixture("other", defaultCaps, "planned", false);
  const row = await prisma.strategyIncentiveReview.findUniqueOrThrow({ where: { id: f.review!.review_id } });
  await assert.rejects(prisma.strategyIncentiveReview.create({ data: { ...row, id: randomUUID(), merchantId: "other", strategyId: other.hypothesis.id,
    proposalHash: other.version.proposalHash, recommendationHash: other.reviewCommand.recommendation_hash,
    policyHash: other.source.policy.policyHash, expiresAt: other.version.expiresAt, createdAt: new Date(), kind: "withdraw", sequence: 2 } }), /withdrawal requires approval/);
});

for (const isolationLevel of ["ReadCommitted", "RepeatableRead"] as const)
spec(`${isolationLevel} fences financial writes from snapshots preceding withdrawal`, async () => {
  const f = await fixture();
  let seen!: () => void, resume!: () => void;
  const snapshot = new Promise<void>(resolve => { seen = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  const attempt = prisma.$transaction(async t => {
    await t.strategyIncentiveReviewHead.findMany(); seen(); await gate;
    return t.strategyIncentiveBudget.create({ data: rawFunding(f) });
  }, { isolationLevel });
  const rejected = assert.rejects(attempt, /requires specific merchant approval|serialize|write conflict|deadlock/i);
  await snapshot;
  try { await reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "withdraw-snapshot" }); }
  finally { resume(); }
  await rejected;
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

for (const mode of ["missing", "legacy", "blocked"] as const)
spec(`new funding rejects ${mode} planning in the application and raw SQL`, async () => {
  const f = await fixture("store", defaultCaps, mode);
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /PLANNED_RECOMMENDATION_REQUIRED|MEASUREMENT_BLOCKED/);
  await assert.rejects(prisma.strategyIncentiveBudget.create({ data: rawFunding(f) }), /requires the planned recommendation/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("a completed feasible recommendation binds every funding dimension even below merchant limits", async () => {
  const f = await fixture();
  for (const patch of [{ limitCents: 499500 }, { maxDiscountCents: 400 }, { maxRedemptions: 999 }]) {
    const terms = { ...f.terms, ...patch };
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) })), /RECOMMENDED_TERMS_CHANGED/);
    const row = rawFunding(f, patch); row.terms = { ...row.terms, ...patch }; row.termsHash = digest(row.terms);
    await assert.rejects(prisma.strategyIncentiveBudget.create({ data: row }), /requires the planned recommendation/);
  }
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("publication alone cannot fund an unfinished analysis", async () => {
  const f = await fixture();
  await prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data: { status: "running" } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /ANALYSIS_NOT_COMPLETED/);
  await assert.rejects(prisma.strategyIncentiveBudget.create({ data: rawFunding(f) }), /requires the planned recommendation/);
});

spec("raw reservations refuse a superseded or rejected recommendation and still allow terminal reconciliation", async () => {
  const f = await ready(), existing = await reserve(f), buyer = await session();
  const raw = { ...buyer, id: randomUUID(), budgetId: f.budget.id, requestKey: "raw-version", requestHash: "a".repeat(64),
    amountCents: 500, reservedAt: new Date() };
  for (const patch of [{ currentVersion: 2 }, { currentVersion: 1, status: "rejected" }, { status: "revision_pending" }]) {
    await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: patch });
    await assert.rejects(prisma.strategyIncentiveReservation.create({ data: raw }), /requires the planned recommendation/);
  }
  assert.equal((await tx(t => reserveIncentiveBudget(t, existing.input))).id, existing.row.id);
  await tx(t => resolveIncentiveBudget(t, resolution(existing.row.id)));
  assert.equal((await totals(f)).spentCents, 500);
});

for (const isolationLevel of ["ReadCommitted", "RepeatableRead"] as const)
spec(`${isolationLevel} fences funding from a proposal superseded after its snapshot`, async () => {
  const f = await fixture();
  let seen!: () => void, resume!: () => void;
  const snapshot = new Promise<void>(resolve => { seen = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const attempt = prisma.$transaction(async t => {
    await t.revenueStrategy.findUniqueOrThrow({ where: { id: f.hypothesis.id } }); seen(); await gate;
    return t.strategyIncentiveBudget.create({ data: rawFunding(f) });
  }, { isolationLevel });
  const rejected = assert.rejects(attempt, /requires the planned recommendation|serialize|write conflict|deadlock/i);
  await snapshot;
  try { await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 2 } }); }
  finally { resume(); }
  await rejected;
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("funding approval is separate, exact, idempotent and creates no coupon or active experiment", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => tx(t => registerReviewedIncentiveBudget(t, f.input))));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 1);
  assert.equal(await prisma.strategyExecution.count(), 0); assert.equal(await prisma.coupon.count(), 0);
  assert.equal((await prisma.revenueStrategy.findUniqueOrThrow({ where: { id: f.hypothesis.id } })).status, "pending_review");
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, actorId: "other-owner" })), /APPROVAL_KEY_CONFLICT/);
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, requestKey: "duplicate" })), /ALREADY_REVIEWED/);
});

const policies = new IncentivePolicyService(prisma);
const policyCommand = { expectedVersion: 0, requestKey: "settings", enabled: true, limitCents: 1000, maxDiscountCents: 500, maxRedemptions: 10 };

spec("stores start disabled and reading settings does not create a financial permission", async () => {
  await prisma.merchant.create({ data: { id: "store", name: "Loja" } });
  const value = await policies.read("store");
  assert.equal(value.enabled, false); assert.equal(value.version, 0); assert.equal(value.limitCents, 0);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0);
  await assert.rejects(policies.save("missing", "owner", policyCommand), /STORE_NOT_FOUND/);
});

spec("saving settings is idempotent and a lost-response retry returns the historical receipt", async () => {
  await prisma.merchant.create({ data: { id: "store", name: "Loja" } });
  const first = await policies.save("store", "owner", policyCommand);
  await policies.save("store", "owner", { ...policyCommand, expectedVersion: 1, requestKey: "next", enabled: false });
  assert.deepEqual(await policies.save("store", "owner", policyCommand), first);
  assert.equal((await policies.read("store")).version, 2);
  await assert.rejects(policies.save("store", "owner", { ...policyCommand, enabled: false }), /REQUEST_CONFLICT/);
  await assert.rejects(policies.save("store", "other", policyCommand), /REQUEST_CONFLICT/);
  await assert.rejects(policies.save("store", "owner", { ...policyCommand, requestKey: "stale" }), /VERSION_CONFLICT/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0); assert.equal(await prisma.coupon.count(), 0);
});

spec("concurrent settings changes accept exactly one version and keep stores separate", async () => {
  await prisma.merchant.createMany({ data: [{ id: "store", name: "A" }, { id: "other", name: "B" }] });
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => policies.save("store", "owner", { ...policyCommand, requestKey: `save-${i}` })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  await policies.save("other", "owner", { ...policyCommand, limitCents: 2000 });
  assert.equal((await policies.read("store")).limitCents, 1000);
  assert.equal((await policies.read("other")).limitCents, 2000);
});

spec("invalid monetary limits never create a policy or advance its head", async () => {
  await prisma.merchant.create({ data: { id: "store", name: "Loja" } });
  for (const patch of [{ enabled: "true" }, { limitCents: 0 }, { limitCents: 2147483648 }, { limitCents: 999.5 },
    { maxDiscountCents: 1001 }, { maxRedemptions: 0 }, { maxRedemptions: 1000001 }, { limitCents: "1000" }, { maxDiscountCents: -1 }]) {
    await assert.rejects(policies.save("store", "owner", { ...policyCommand, ...patch } as never), /INVALID_LIMITS/);
  }
  assert.equal(await prisma.merchantIncentivePolicyHead.count(), 0);
  await policies.save("store", "owner", { ...policyCommand, enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 });
});

spec("financial settings history and version head cannot be rewritten or erased", async () => {
  await fixture();
  await assert.rejects(prisma.merchantIncentivePolicy.update({ where: { merchantId_version: { merchantId: "store", version: 1 } }, data: { enabled: false } }), /immutable/);
  await assert.rejects(prisma.merchantIncentivePolicy.deleteMany(), /immutable/);
  await assert.rejects(prisma.merchantIncentivePolicyHead.update({ where: { merchantId: "store" }, data: { currentVersion: 9 } }), /requires a new policy/);
  await assert.rejects(prisma.merchantIncentivePolicyHead.deleteMany(), /requires a new policy/);
  const row = await prisma.merchantIncentivePolicy.findFirstOrThrow();
  await assert.rejects(prisma.merchantIncentivePolicy.create({ data: { ...row, version: 3, requestKey: "skip" } }), /version conflict/);
  assert.equal((await prisma.merchantIncentivePolicyHead.findFirstOrThrow()).currentVersion, 1);
});

for (const [label, patch] of [["disabled", { enabled: false }], ["lower", { limitCents: 500 }],
  ["higher", { limitCents: 1000000 }], ["same values new version", {}]] as const)
spec(`a ${label} policy stops old funding and reservations while preserving settlement`, async () => {
  const f = await ready(), existing = await reserve(f);
  await policies.save("store", "owner", { ...policyCommand, ...defaultCaps, expectedVersion: 1, requestKey: "changed", ...patch });
  await assert.rejects(reserve(f), /POLICY_CHANGED/);
  const buyer = await session();
  await assert.rejects(prisma.strategyIncentiveReservation.create({ data: { ...buyer, id: randomUUID(), budgetId: f.budget.id,
    requestKey: "raw-stale", requestHash: "a".repeat(64), amountCents: 100, reservedAt: new Date() } }), /policy changed or unavailable/);
  assert.equal((await tx(t => registerReviewedIncentiveBudget(t, f.input))).id, f.budget.id);
  assert.equal((await tx(t => reserveIncentiveBudget(t, existing.input))).id, existing.row.id);
  await tx(t => resolveIncentiveBudget(t, resolution(existing.row.id)));
  assert.equal((await totals(f)).spentCents, 500); assert.equal((await totals(f)).reservedCents, 0);
});

spec("a policy change between preparing and approving funding requires fresh terms", async () => {
  const f = await fixture();
  await policies.save("store", "owner", { ...policyCommand, expectedVersion: 1, requestKey: "changed" });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /POLICY_CHANGED/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("raw funding cannot omit its policy, forge its binding or exceed merchant caps", async () => {
  const f = await fixture();
  const data = { id: randomUUID(), merchantId: "store", strategyId: f.hypothesis.id, version: 1,
    proposalHash: f.terms.proposalHash, termsHash: f.input.termsHash, terms: f.terms,
    policyVersion: 1, actorId: "owner", requestKey: "raw", requestHash: "a".repeat(64),
    ...defaultCaps,
    startsAt: new Date(f.terms.startsAt), endsAt: new Date(f.terms.endsAt), approvedAt: new Date() };
  for (const patch of [{ policyVersion: null }, { policyVersion: 2 }, { terms: { ...f.terms, policyHash: "b".repeat(64) } },
    { limitCents: 500001 }, { maxDiscountCents: 501 }, { maxRedemptions: 1001 }]) {
    await assert.rejects(prisma.strategyIncentiveBudget.create({ data: { ...data, ...patch } }), /policy changed or unavailable/);
  }
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("a rejected raw financial policy rolls back its version head", async () => {
  await fixture();
  const row = await prisma.merchantIncentivePolicy.findFirstOrThrow();
  await assert.rejects(prisma.merchantIncentivePolicy.create({ data: { ...row, version: 2, requestKey: "invalid", limitCents: -1 } }), /constraint/i);
  assert.equal((await prisma.merchantIncentivePolicyHead.findFirstOrThrow()).currentVersion, 1);
  assert.equal((await policies.read("store")).version, 1);
});

spec("disabled financial settings preserve a cancelled reservation until explicit resolution", async () => {
  const f = await ready(), existing = await reserve(f);
  await policies.save("store", "owner", { ...policyCommand, expectedVersion: 1, requestKey: "off", enabled: false });
  assert.equal((await totals(f)).reservedCents, 500);
  await tx(t => resolveIncentiveBudget(t, resolution(existing.row.id, "released", 0)));
  assert.equal((await totals(f)).reservedCents, 0); assert.equal((await totals(f)).spentCents, 0);
});

for (const isolationLevel of ["ReadCommitted", "RepeatableRead"] as const)
spec(`${isolationLevel} cannot reserve from a policy snapshot taken before a committed change`, async () => {
  const f = await ready(), buyer = await session();
  let seen!: () => void, resume!: () => void;
  const snapshot = new Promise<void>(resolve => { seen = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const attempt = prisma.$transaction(async t => {
    await t.merchantIncentivePolicy.findFirstOrThrow(); seen(); await gate;
    return t.strategyIncentiveReservation.create({ data: { ...buyer, id: randomUUID(), budgetId: f.budget.id,
      requestKey: "stale-snapshot", requestHash: "a".repeat(64), amountCents: 100, reservedAt: new Date() } });
  }, { isolationLevel });
  const rejected = assert.rejects(attempt, /policy changed|serialize|write conflict|deadlock/i);
  await snapshot;
  try { await policies.save("store", "owner", { ...policyCommand, expectedVersion: 1, requestKey: "changed", enabled: false }); }
  finally { resume(); }
  await rejected;
  assert.equal((await totals(f)).reservedCents, 0);
});

spec("funding requires an explicit store flag and exact terms, actor and source proposal", async () => {
  const f = await fixture();
  for (const allowed of ["", "*", "other"]) {
    process.env.REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS = allowed;
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /BUDGET_DISABLED/);
  }
  process.env.REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS = "store";
  for (const input of [{ ...f.input, termsHash: "b".repeat(64) }, { ...f.input, actorId: " " }, { ...f.input, merchantId: "other" }]) {
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, input)), /INVALID_APPROVAL/);
  }
  const terms = { ...f.terms, proposalHash: "b".repeat(64) };
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) })), /PROPOSAL_CHANGED/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("approval rejects changed policy, stale versions, past start and an already active communication strategy", async () => {
  const f = await fixture();
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { maxDiscountPercent: 4 } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /INVALID_DISCOUNT_STUDY/);
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { maxDiscountPercent: 5 } });
  for (const status of ["rejected", "active", "revision_pending"]) {
    await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { status } });
    await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /PROPOSAL_CHANGED/);
  }
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { status: "pending_review", currentVersion: 2 } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /PROPOSAL_CHANGED/);
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 1 } });
  const terms = { ...f.terms, startsAt: new Date(Date.now() - 10).toISOString() };
  terms.endsAt = new Date(Date.parse(terms.startsAt) + 7 * 86400000).toISOString();
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) })), /APPROVAL_EXPIRED/);
});

spec("parallel reservations cannot exceed the strategy monetary ceiling", async () => {
  const f = await ready();
  await fill(f, 998);
  const inputs = await Promise.all(Array.from({ length: 12 }, async () => ({ ...await session(), budgetId: f.budget.id,
    requestKey: randomUUID(), amountCents: 400 })));
  const attempts = await Promise.allSettled(inputs.map(input => tx(t => reserveIncentiveBudget(t, input))));
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 2);
  const sum = await totals(f);
  assert.equal(sum.reservedCents, 499800); assert.equal(sum.uncommittedCents, 200); assert.equal(sum.spentCents, 0);
});

spec("redemption slots and one use per buyer hold across concurrent different sessions", async () => {
  const f = await ready();
  await fill(f, 998, 1);
  const buyers = await Promise.all(Array.from({ length: 6 }, () => session("store", randomUUID(), "same-buyer")));
  const attempts = await Promise.allSettled(buyers.map(b => reserve(f, 100, randomUUID(), b)));
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
  await reserve(f, 100);
  await assert.rejects(reserve(f, 1), /budget unavailable or exhausted/);
  assert.equal((await totals(f)).reservedCount, 1000);
});

spec("exact retry is stable and conflicting retry cannot alter money, session or buyer", async () => {
  const f = await ready(), r = await reserve(f);
  const rows = await Promise.all(Array.from({ length: 6 }, () => tx(t => reserveIncentiveBudget(t, r.input))));
  assert.equal(new Set(rows.map(row => row.id)).size, 1);
  for (const patch of [{ amountCents: 1 }, { buyerId: "other" }, { sessionId: "other" }]) {
    await assert.rejects(tx(t => reserveIncentiveBudget(t, { ...r.input, ...patch })), /RESERVATION_KEY_CONFLICT/);
  }
  assert.equal((await totals(f)).reservedCents, 500);
});

spec("tenant, buyer, currency, holdout and per-offer cap are enforced before committing a reservation", async () => {
  const f = await ready();
  await assert.rejects(reserve(f, 501), /budget unavailable or exhausted/);
  await assert.rejects(reserve(f, 10, randomUUID(), await session("store", "holdout", "holdout", "holdout")), /context invalid/);
  await assert.rejects(reserve(f, 10, randomUUID(), await session("store", "usd", "usd", "treatment", "USD")), /context invalid/);
  const own = await session();
  await assert.rejects(reserve(f, 10, randomUUID(), { ...own, buyerId: "forged" }), /context invalid/);
  await assert.rejects(reserve(f, 10, randomUUID(), { ...own, merchantId: "other" }), /BUDGET_NOT_FOUND/);
  await assert.rejects(tx(t => readIncentiveBudget(t, "other", f.budget.id)), /BUDGET_NOT_FOUND/);
  assert.equal((await totals(f)).reservedCents, 0);
});

spec("unknown reservations retain funds after closure, and resolution works with the feature disabled", async () => {
  const f = await ready(), r = await reserve(f);
  await tx(t => closeIncentiveBudget(t, { merchantId: "store", budgetId: f.budget.id, actorId: "owner", reason: "Pausar novos incentivos" }));
  await assert.rejects(reserve(f), /budget unavailable or exhausted/);
  assert.equal((await totals(f)).reservedCents, 500);
  process.env.REVENUE_INCENTIVE_BUDGET_ENABLED = "false";
  assert.equal((await tx(t => reserveIncentiveBudget(t, r.input))).id, r.row.id);
  const input = resolution(r.row.id, "released", 0);
  await tx(t => resolveIncentiveBudget(t, input));
  await tx(t => resolveIncentiveBudget(t, input));
  const sum = await totals(f);
  assert.equal(sum.status, "closed"); assert.equal(sum.reservedCents, 0); assert.equal(sum.uncommittedCents, 500000);
  assert.equal((await tx(t => registerReviewedIncentiveBudget(t, f.input))).id, f.budget.id);
});

spec("partial consumption charges actual cents and releases the unused amount exactly once", async () => {
  const f = await ready(), r = await reserve(f);
  const input = resolution(r.row.id, "spent", 350);
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => tx(t => resolveIncentiveBudget(t, input))));
  assert.equal(new Set(outcomes.map(row => row.id)).size, 1);
  const sum = await totals(f);
  assert.equal(sum.reservedCents, 0); assert.equal(sum.spentCents, 350); assert.equal(sum.spentCount, 1);
  assert.equal(sum.uncommittedCents, 499650);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(r.row.id, "released", 0))), /RESOLUTION_CONFLICT/);
  await assert.rejects(reserve(f, 100, randomUUID(), r.input), /unique constraint/i);
});

spec("cancellation frees capacity but retrying its original request never reopens the reservation", async () => {
  const f = await ready(), r = await reserve(f);
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id, "released", 0)));
  assert.equal((await tx(t => reserveIncentiveBudget(t, r.input))).status, "released");
  await reserve(f, 500, "replacement", r.input);
  assert.equal((await totals(f)).reservedCount, 1); assert.equal(await prisma.strategyIncentiveReservation.count(), 2);
});

spec("reserve, cancellation and consumption roll back with the enclosing commerce transaction", async () => {
  const f = await ready(), buyer = await session();
  await assert.rejects(tx(async t => {
    await reserveIncentiveBudget(t, { ...buyer, budgetId: f.budget.id, requestKey: "rollback", amountCents: 500 });
    throw new Error("checkout save failed");
  }), /checkout save failed/);
  assert.equal((await totals(f)).reservedCents, 0); assert.equal(await prisma.strategyIncentiveReservation.count(), 0);
  const r = await reserve(f);
  for (const input of [resolution(r.row.id), resolution(r.row.id, "released", 0)]) {
    await assert.rejects(tx(async t => { await resolveIncentiveBudget(t, input); throw new Error("commerce failed"); }), /commerce failed/);
    assert.equal((await totals(f)).reservedCents, 500); assert.equal((await totals(f)).spentCents, 0);
  }
});

spec("conflicting consume/cancel commands have a single terminal outcome", async () => {
  const f = await ready(), r = await reserve(f);
  const attempts = await Promise.allSettled([resolution(r.row.id), resolution(r.row.id, "released", 0)]
    .map(input => tx(t => resolveIncentiveBudget(t, input))));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  const row = await prisma.strategyIncentiveReservation.findUniqueOrThrow({ where: { id: r.row.id } });
  const sum = await totals(f);
  assert.equal(sum.reservedCents, 0); assert.equal(sum.spentCents, row.status === "spent" ? 500 : 0);
});

spec("invalid amounts and duplicate commerce evidence cannot release or overspend reservations", async () => {
  const f = await ready(), a = await reserve(f), b = await reserve(f);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(a.row.id, "spent", 501))), /RESERVATION_EXCEEDED/);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(a.row.id, "spent", 0))), /INVALID_RESOLUTION/);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, resolution(a.row.id, "released", 10))), /INVALID_RESOLUTION/);
  await tx(t => resolveIncentiveBudget(t, resolution(a.row.id)));
  await assert.rejects(tx(t => resolveIncentiveBudget(t, { ...resolution(b.row.id), evidenceKey: resolution(a.row.id).evidenceKey })), /unique constraint/i);
  await assert.rejects(tx(t => resolveIncentiveBudget(t, { ...resolution(b.row.id), merchantId: "other" })), /RESERVATION_NOT_FOUND/);
  assert.equal((await totals(f)).reservedCents, 500); assert.equal((await totals(f)).spentCents, 500);
});

spec("database denies rewritten terms, fabricated counters, reopened reservations and erased evidence", async () => {
  const f = await ready(), r = await reserve(f);
  await assert.rejects(prisma.strategyIncentiveBudget.update({ where: { id: f.budget.id }, data: { limitCents: 100000 } }), /immutable/);
  await assert.rejects(prisma.strategyIncentiveBudget.update({ where: { id: f.budget.id }, data: { reservedCents: 0 } }), /reservation evidence/);
  await assert.rejects(prisma.strategyIncentiveBudget.delete({ where: { id: f.budget.id } }), /durable/);
  await assert.rejects(prisma.strategyIncentiveReservation.update({ where: { id: r.row.id }, data: { amountCents: 1 } }), /invalid or final/);
  await assert.rejects(prisma.strategyIncentiveReservation.delete({ where: { id: r.row.id } }), /durable/);
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id)));
  await assert.rejects(prisma.strategyIncentiveReservation.update({ where: { id: r.row.id }, data: { status: "reserved" } }), /invalid or final/);
  await tx(t => closeIncentiveBudget(t, { merchantId: "store", budgetId: f.budget.id, actorId: "owner", reason: "Fim" }));
  await assert.rejects(prisma.strategyIncentiveBudget.update({ where: { id: f.budget.id }, data: { closedAt: null, closedBy: null, closeReason: null } }), /closure is final/);
});

spec("raw concurrent inserts cannot bypass the accounting ceiling", async () => {
  const f = await ready();
  await fill(f, 998);
  const inputs = await Promise.all(Array.from({ length: 10 }, async () => ({ ...await session(), id: randomUUID(),
    budgetId: f.budget.id, requestKey: randomUUID(), requestHash: "a".repeat(64), amountCents: 400, reservedAt: new Date() })));
  const attempts = await Promise.allSettled(inputs.map(input => prisma.strategyIncentiveReservation.create({ data: input })));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 2);
  assert.equal((await totals(f)).reservedCents, 499800);
});

spec("repeatable-read snapshots are fenced rather than silently overspending", async () => {
  const f = await ready();
  await fill(f, 999);
  const buyers = await Promise.all([session(), session()]);
  let arrived = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const attempts = await Promise.allSettled(buyers.map(buyer => prisma.$transaction(async t => {
    await t.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: f.budget.id } });
    if (++arrived === 2) release();
    await gate;
    return t.strategyIncentiveReservation.create({ data: { ...buyer, id: randomUUID(), budgetId: f.budget.id,
      requestKey: randomUUID(), requestHash: "a".repeat(64), amountCents: 500, reservedAt: new Date() } });
  }, { isolationLevel: "RepeatableRead" })));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  assert.equal((await totals(f)).reservedCents, 500000);
});

spec("a changed policy or superseded proposal blocks new reservations but leaves settlement possible", async () => {
  const f = await ready(), r = await reserve(f);
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { autonomousEngineEnabled: false } });
  await assert.rejects(reserve(f), /INVALID_DISCOUNT_STUDY/);
  await prisma.merchantRule.update({ where: { merchantId: "store" }, data: { autonomousEngineEnabled: true } });
  await prisma.revenueStrategy.update({ where: { id: f.hypothesis.id }, data: { currentVersion: 2 } });
  await assert.rejects(reserve(f), /PROPOSAL_CHANGED/);
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id)));
  assert.equal((await totals(f)).spentCents, 500);
});

spec("funding approval rolls back with its enclosing review transaction", async () => {
  const f = await fixture();
  await assert.rejects(tx(async t => { await registerReviewedIncentiveBudget(t, f.input); throw new Error("review failed"); }), /review failed/);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
  await tx(t => registerReviewedIncentiveBudget(t, f.input));
  assert.equal(await prisma.strategyIncentiveBudget.count(), 1);
});

spec("no reservation can spend scheduled capacity before the reviewed start", async () => {
  const f = await fixture();
  const terms = { ...f.terms, startsAt: new Date(Date.now() + 60000).toISOString(), endsAt: new Date(Date.now() + 60000 + 7 * 86400000).toISOString() };
  terms.endsAt = new Date(Date.parse(terms.startsAt) + 7 * 86400000).toISOString();
  const budget = await tx(t => registerReviewedIncentiveBudget(t, { ...f.input, terms, termsHash: digest(terms) }));
  const buyer = await session();
  await assert.rejects(tx(t => reserveIncentiveBudget(t, { ...buyer, budgetId: budget.id, amountCents: 100, requestKey: "early" })), /budget unavailable or exhausted/);
  const sum = await tx(t => readIncentiveBudget(t, "store", budget.id));
  assert.equal(sum.status, "scheduled"); assert.equal(sum.reservedCents, 0);
});

spec("independent stores have separate caps and cannot consume each other's balances", async () => {
  const a = await ready(), other = await fixture("other");
  const b = await tx(t => registerReviewedIncentiveBudget(t, other.input));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, b.startsAt.getTime() - Date.now() + 5)));
  const r = await reserve(a);
  const buyer = await session("other");
  const own = { ...buyer, budgetId: b.id, amountCents: 500, requestKey: "other-reservation" };
  await assert.rejects(tx(t => reserveIncentiveBudget(t, { ...own, budgetId: a.budget.id })), /BUDGET_NOT_FOUND/);
  await tx(t => reserveIncentiveBudget(t, own));
  await tx(t => resolveIncentiveBudget(t, resolution(r.row.id)));
  assert.equal((await totals(a)).spentCents, 500);
  const summary = await tx(t => readIncentiveBudget(t, "other", b.id));
  assert.equal(summary.reservedCents, 500); assert.equal(summary.spentCents, 0);
});

spec("raw inserts cannot invent pre-spent or pre-released receipts", async () => {
  const f = await ready(), buyer = await session();
  for (const status of ["spent", "released"]) {
    await assert.rejects(prisma.strategyIncentiveReservation.create({ data: { ...buyer, id: randomUUID(), budgetId: f.budget.id,
      requestKey: randomUUID(), requestHash: "a".repeat(64), amountCents: 500, reservedAt: new Date(), status,
      spentCents: status === "spent" ? 500 : 0, resolvedAt: new Date(), evidenceKey: randomUUID(), resolutionHash: "a".repeat(64) } }), /context invalid/);
  }
  assert.equal((await totals(f)).reservedCents, 0); assert.equal((await totals(f)).spentCents, 0);
});

spec("stopping and reserving concurrently preserves any admitted funds for explicit reconciliation", async () => {
  const f = await ready(), buyer = await session();
  const attempts = await Promise.allSettled([
    tx(t => reserveIncentiveBudget(t, { ...buyer, budgetId: f.budget.id, amountCents: 500, requestKey: "racing" })),
    tx(t => closeIncentiveBudget(t, { merchantId: "store", budgetId: f.budget.id, actorId: "owner", reason: "Parar" })),
  ]);
  assert.equal(attempts[1].status, "fulfilled");
  const sum = await totals(f);
  assert.equal(sum.status, "closed"); assert.equal(sum.reservedCents, attempts[0].status === "fulfilled" ? 500 : 0);
  await assert.rejects(reserve(f), /budget unavailable or exhausted/);
});

spec("removing weekly enrollment prevents new funding", async () => {
  const f = await fixture();
  await prisma.revenueAnalysisSchedule.delete({ where: { merchantId: "store" } });
  await assert.rejects(tx(t => registerReviewedIncentiveBudget(t, f.input)), /WEEKLY_OWNERSHIP_REQUIRED/);
});

spec("financial timestamps keep the same UTC horizon under different database session timezones", async () => {
  for (const [merchantId, zone] of [["store", "America/Sao_Paulo"], ["other", "Asia/Tokyo"]]) {
    const f = await fixture(merchantId);
    const zoned = <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => tx(async t => {
      await t.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
      return work(t);
    });
    const budget = await zoned(t => registerReviewedIncentiveBudget(t, f.input));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, budget.startsAt.getTime() - Date.now() + 5)));
    const buyer = await session(merchantId);
    const row = await zoned(t => reserveIncentiveBudget(t, { ...buyer, budgetId: budget.id, requestKey: "zoned", amountCents: 500 }));
    await zoned(t => closeIncentiveBudget(t, { merchantId, budgetId: budget.id, actorId: "owner", reason: "Fim" }));
    await zoned(t => resolveIncentiveBudget(t, { ...resolution(row.id), merchantId }));
    const sum = await zoned(t => readIncentiveBudget(t, merchantId, budget.id));
    assert.equal(sum.status, "closed"); assert.equal(sum.spentCents, 500); assert.equal(sum.reservedCents, 0);
  }
});

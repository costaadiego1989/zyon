import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { discountStudy } from "../domain/strategy-discount-study.js";
import { plannedIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { PrismaObservationRepository } from "../infrastructure/prisma-observation.repository.js";
import { PrismaHypothesisRepository } from "../infrastructure/prisma-hypothesis.repository.js";
import { merchantRulesSnapshot } from "../infrastructure/hypothesis-merchant-context.adapter.js";
import { incentiveAssignmentArm } from "../infrastructure/incentive-execution-ledger.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { IncentivePolicyService } from "./incentive-policy.service.js";
import { IncentiveReviewService } from "./incentive-review.service.js";
import { IncentiveMetricsService } from "./incentive-metrics.service.js";

// Sequential suite; destructive setup only for the dedicated disposable database.
const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, transactionOptions: { maxWait: 10000, timeout: 30000 } });
const env = { ...process.env }, billing = { getEffectivePlan: async () => "scale" };
const reviews = new IncentiveReviewService(prisma, billing as never);
const baseline = "Explique os dados verificados.";
const response = () => ({ hypothesis_text: "Testar uma explicação das etapas", reasoning: "Comparar as sessões observadas", expected_lift_percent: 1,
  template: { name: "Explicação", description: "Explicar as próximas etapas",
    variant_a: { name: "Controle", system_prompt: baseline, weight: 50, is_control: true },
    variant_b: { name: "Teste", system_prompt: "Pergunte qual etapa precisa de explicação.", weight: 50, is_control: false } } });
const spec = (name: string, fn: () => Promise<void>) => test(`incentive metrics ${name}`, { skip: !enabled }, fn);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { process.env = env; await prisma.$disconnect(); });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "*",
    REVENUE_INCENTIVE_BUDGET_ENABLED: "true", REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS: "store,other",
    REVENUE_INCENTIVE_REVIEW_ENABLED: "true", REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS: "store,other",
    REVENUE_INCENTIVE_EXECUTION_ENABLED: "true", REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: "store,other",
    REVENUE_DISCOUNT_STUDY_ENABLED: "false", REVENUE_STRATEGY_MEASUREMENT_ENABLED: "false" };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_analysis_runs, revenue_analysis_schedules,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, checkout_settings,
    merchants, checkout_sessions, completed_orders, prompt_experiments, coupons, products, buyer_intent_memory_consents, payment_intents CASCADE`);
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

// Advance only the measurement clock. Persisted assignments, payment evidence,
// immutable rows and the actual aggregation SQL still use the real database.
function metricsAt(now: Date) {
  const client = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (fn: any, options: any) => target.$transaction(tx => fn(new Proxy(tx, { get(inner, field) {
      if (field !== "$queryRaw") return Reflect.get(inner, field);
      return (query: TemplateStringsArray, ...values: any[]) => query[0].trim() === "SELECT clock_timestamp() AS now"
        ? Promise.resolve([{ now }]) : inner.$queryRaw(query, ...values);
    } })), options);
  } });
  return new IncentiveMetricsService(client);
}

async function funded() {
  const f = await fixture();
  await reviews.decide("store", "owner", f.id, "approve", f.input);
  const execution = await prisma.strategyIncentiveExecution.findFirstOrThrow({ where: { merchantId: "store", strategyId: f.id } });
  await prisma.product.create({ data: { id: "product", merchantId: "store", name: "Produto",
    variants: { create: { id: "variant", sku: "sku", price: { create: { basePriceInCents: 10000, costInCents: 4000 } } } } } });
  return { ...f, execution, matureAt: new Date(execution.endsAt.getTime() + 8 * 86400000) };
}

async function assigned(f: Awaited<ReturnType<typeof funded>>, arm: "control" | "treatment") {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, f.execution.startedAt.getTime() - Date.now() + 5)));
  let buyerId = randomUUID();
  while (incentiveAssignmentArm(f.execution.id, buyerId) !== arm) buyerId = randomUUID();
  const now = new Date(), sessionId = randomUUID();
  await prisma.buyerIntentMemoryConsent.create({ data: { merchantId: "store", globalUserId: buyerId, optedIn: true,
    expiresAt: new Date(now.getTime() + 86400000), intents: { create: { primaryIntent: "price_sensitive", urgency: "high",
      budgetTier: "low", categoryFocus: [], painPoints: [], conversionLikelihoodPct: 10, behavioralSignalsJson: {}, generatedAt: now } } } });
  const row = await prisma.checkoutSession.create({ data: { merchantId: "store", sessionId, globalUserId: buyerId, conversationId: sessionId,
    cohort: "treatment", createdAt: now, updatedAt: now,
    cart: { currency: "BRL", total: 100, items: [{ sku: "sku", variantId: "variant", name: "Produto", price: 100, quantity: 1 }] },
    shipping: { customerPrice: 10, realCost: 10 } } });
  const session = toCheckoutSession(row);
  await new PrismaCheckoutRepository(prisma).saveSession(session);
  return session;
}

async function approved(session: Awaited<ReturnType<typeof assigned>>) {
  const discountCents = Math.round((session.cart.currentDiscount ?? 0) * 100), totalCents = 11000 - discountCents;
  const intent = PaymentIntentEntity.create({ merchantId: "store", sessionId: session.sessionId, idempotencyKey: randomUUID(),
    currency: "BRL", method: "pix", amountCents: totalCents, amountBreakdown: { version: 1, currency: "BRL",
      cartFingerprint: paymentCartFingerprint(session), itemsSubtotalCents: 10000, shippingCents: 1000,
      discountCents, platformFeeCents: 0, totalCents } });
  const payments = new PrismaPaymentRepository(prisma);
  await payments.saveIntent({ intent });
  intent.markApproved({ providerPaymentId: randomUUID(), approvedAmountCents: totalCents });
  await payments.saveIntent({ intent });
  return { intent, payments };
}

async function order(session: Awaited<ReturnType<typeof assigned>>, payment: Awaited<ReturnType<typeof approved>>, overrides = {}) {
  const snapshot = payment.intent.snapshot();
  return prisma.completedOrder.create({ data: { id: randomUUID(), merchantId: "store", sessionId: session.sessionId,
    externalOrderId: snapshot.providerPaymentId!, orderTotal: snapshot.amountCents / 100, currency: "BRL", status: "approved",
    completedAt: new Date(), ...overrides } });
}

spec("pending approval has no measured result and wrong store/version cannot read it", async () => {
  const f = await fixture(), metrics = new IncentiveMetricsService(prisma);
  const result = await metrics.read("store", f.id, 1);
  assert.equal(result.execution, null); assert.equal(result.measurement, null);
  await assert.rejects(metrics.read("other", f.id, 1), /NOT_FOUND/);
  await assert.rejects(metrics.read("store", f.id, 2), /NOT_FOUND/);
  await assert.rejects(metrics.read("store", f.id, 1.5), /INVALID_VERSION/);
});

spec("scheduled execution is not started rather than invalid during the one-second activation delay", async () => {
  const f = await funded();
  const result = await metricsAt(new Date(f.execution.startedAt.getTime() - 1)).read("store", f.id, 1);
  assert.equal(result.measurement!.state, "not_started");
  assert.deepEqual(result.measurement!.reasons, []);
  assert.equal(result.measurement!.control.assigned + result.measurement!.treatment.assigned, 0);
});

spec("counts all assigned buyers and only mature approved orders with exact provider payment evidence", async () => {
  const f = await funded();
  const control = await assigned(f, "control"), treatment = await assigned(f, "treatment");
  await assigned(f, "treatment"); // No purchase remains in the denominator.
  const paid = await approved(treatment);
  await order(treatment, paid, { externalOrderId: "unproven-provider" });
  let result = await metricsAt(f.matureAt).read("store", f.id, 1);
  assert.equal(result.measurement!.treatment.converted, 0);
  await order(treatment, paid, { orderTotal: 99 });
  result = await metricsAt(f.matureAt).read("store", f.id, 1);
  assert.equal(result.measurement!.treatment.converted, 0);
  await prisma.completedOrder.update({ where: { merchantId_sessionId_externalOrderId: { merchantId: "store",
    sessionId: treatment.sessionId, externalOrderId: paid.intent.snapshot().providerPaymentId! } }, data: { orderTotal: 105 } });
  const paidControl = await approved(control); await order(control, paidControl);
  const early = await new IncentiveMetricsService(prisma).read("store", f.id, 1);
  assert.equal(early.measurement!.state, "collecting");
  assert.equal(early.measurement!.treatment.mature, 0); assert.equal(early.measurement!.treatment.converted, 0);
  result = await metricsAt(f.matureAt).read("store", f.id, 1);
  assert.equal(result.measurement!.treatment.assigned, 2); assert.equal(result.measurement!.treatment.mature, 2);
  assert.equal(result.measurement!.treatment.converted, 1); assert.equal(result.measurement!.treatment.orders, 1);
  assert.equal(result.measurement!.treatment.revenueCents, 10500); assert.equal(result.measurement!.treatment.discountCents, 500);
  assert.equal(result.measurement!.control.assigned, 1); assert.equal(result.measurement!.control.converted, 1);
  assert.equal(result.measurement!.control.revenueCents, 11000); assert.equal(result.measurement!.control.discountCents, 0);
  assert.equal(result.measurement!.budget.spentCents, 500); assert.equal(result.measurement!.budget.reservedCents, 500);
  assert.equal(result.measurement!.state, "inconclusive"); assert.equal(result.measurement!.promotionAllowed, false);
});

spec("refunds remove current approved conversion while preserving spend and counting each refund once", async () => {
  const f = await funded(), session = await assigned(f, "treatment"), payment = await approved(session);
  await order(session, payment);
  assert.equal((await metricsAt(f.matureAt).read("store", f.id, 1)).measurement!.treatment.converted, 1);
  payment.intent.markRefunded("buyer request");
  await payment.payments.saveIntent({ intent: payment.intent });
  await payment.payments.saveIntent({ intent: payment.intent });
  const result = await metricsAt(f.matureAt).read("store", f.id, 1);
  assert.equal(result.measurement!.treatment.assigned, 1); assert.equal(result.measurement!.treatment.converted, 0);
  assert.equal(result.measurement!.treatment.revenueCents, 0); assert.equal(result.measurement!.treatment.discountCents, 0);
  assert.equal(result.measurement!.treatment.refunds, 1); assert.equal(result.measurement!.treatment.refundedDiscountCents, 500);
  assert.equal(result.measurement!.treatment.redemptions, 1); assert.equal(result.measurement!.budget.spentCents, 500);
});

spec("excludes approval outside conversion window and notifies a terminal result only once", async () => {
  const f = await funded(), session = await assigned(f, "treatment"), payment = await approved(session);
  const assignment = await prisma.strategyIncentiveAssignment.findFirstOrThrow({ where: { merchantId: "store", sessionId: session.sessionId } });
  await order(session, payment, { completedAt: new Date(assignment.assignedAt.getTime() + 168 * 3600000) });
  const metrics = metricsAt(f.matureAt), result = await metrics.read("store", f.id, 1);
  assert.equal(result.measurement!.treatment.converted, 0); assert.equal(result.measurement!.treatment.orders, 0);
  assert.equal(result.measurement!.treatment.redemptions, 1); assert.equal(result.measurement!.budget.spentCents, 500);
  await metrics.monitor(f.matureAt); await metrics.monitor(f.matureAt);
  assert.equal(await prisma.merchantNotification.count({ where: { id: `incentive-result:${f.execution.id}`, merchantId: "store" } }), 1);
});

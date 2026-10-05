import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { applyEligibleIncentive, applyIncentiveCoupon, incentiveAssignmentArm, invalidateIncentiveCheckout, recordIncentivePayment } from "./incentive-execution-ledger.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { IncentiveMetricsService } from "../application/incentive-metrics.service.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import { FakePaymentProvider } from "../../payment/infrastructure/fake-payment-provider.js";
import { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";
import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { commercialDiscountStudy, discountStudy } from "../domain/strategy-discount-study.js";
import { incentiveBudgetTerms, recommendedIncentiveBudgetTerms } from "../domain/incentive-budget.js";
import { conservativeIncentiveAlternative, incentiveRecommendation, plannedCommercialIncentiveRecommendation, plannedIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";
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
    REVENUE_COMMERCIAL_MODES_ENABLED: "true", REVENUE_COMMERCIAL_MODES_MERCHANT_IDS: "store,other",
    REVENUE_INCENTIVE_EXECUTION_ENABLED: "true", REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: "store,other", REVENUE_DISCOUNT_STUDY_ENABLED: "false", REVENUE_STRATEGY_MEASUREMENT_ENABLED: "false" };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_analysis_runs, revenue_analysis_schedules,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, checkout_settings,
    merchants, checkout_sessions, completed_orders, prompt_experiments, coupons, products, buyer_intent_memory_consents, payment_intents CASCADE`);
});

const defaultCaps = { limitCents: 500000, maxDiscountCents: 500, maxRedemptions: 1000 };
type CommercialMode = "fixed" | "percentage" | "shipping";
async function fixture(merchantId = "store", caps = defaultCaps, mode: "planned" | "legacy" | "missing" | "blocked" = "planned", reviewed = true, ageMs = 0, commercial?: CommercialMode) {
  const now = new Date();
  const asOf = new Date(now.getTime() - ageMs);
  await prisma.merchant.create({ data: { id: merchantId, name: "Fixture" } });
  const policy = await new IncentivePolicyService(prisma).save(merchantId, "owner", {
    expectedVersion: 0, requestKey: "policy-first", enabled: true, ...caps });
  const rules = merchantRulesSnapshot(await prisma.merchantRule.create({ data: { merchantId,
    maxDiscountPercent: 5, minimumMarginPercent: 30, allowFreeShipping: false, allowShippingDiscount: commercial === "shipping",
    allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: true, autonomousEngineEnabled: true,
    freeShippingMinCartValue: 200, maxShippingSubsidy: commercial === "shipping" ? 5 : 0,
    maxPartialShippingDiscount: commercial === "shipping" ? 5 : 0, offerExpirationMinutes: 15,
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
  const study = (commercial ? commercialDiscountStudy : discountStudy)({ merchantId, runId: run.id, observationId: observation.id, rules,
    asOf: asOf.toISOString(), capturedAt: now.toISOString(), cohorts: [{ intent: "price_sensitive", sampleSize: 10000, conversionRate: .001,
      carts: Array.from({ length: 10000 }, (_, i) => { const price = commercial === "percentage" && i % 2 ? 200 : 100;
        return { total: price, currency: "BRL", items: [{ sku: "sku", name: "Produto", price, cost: 40, quantity: 1 }] }; }),
      ...(commercial === "shipping" ? { shipping: Array.from({ length: 10000 }, () => ({ customerPrice: 10, realCost: 10 })) } : {}) }] });
  const recommendation = mode === "missing" ? undefined : mode === "legacy" ? incentiveRecommendation(study, rules, policy)
    : (commercial ? plannedCommercialIncentiveRecommendation : plannedIncentiveRecommendation)(study, rules, policy, { buyers: mode === "blocked" ? 1000 : 10000,
      conversions: mode === "blocked" ? 100 : 10, complete: true,
      windowStart: new Date(asOf.getTime() - 35 * 86400000).toISOString(), windowEnd: new Date(asOf.getTime() - 7 * 86400000).toISOString() });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { discountStudyJson: study,
    ...(recommendation ? { incentiveRecommendationJson: recommendation as unknown as Prisma.InputJsonValue } : {}) } });
  const hypothesis = HypothesisEntity.create({ merchant_id: merchantId, observation_id: observation.id,
    hypothesis_text: "Testar uma explicaÃ§Ã£o das etapas", reasoning: "Comparar as sessÃµes observadas", expected_lift_percent: 1,
    template: { name: "ExplicaÃ§Ã£o", description: "Explicar as prÃ³ximas etapas",
      variant_a: { name: "Controle", system_prompt: "Explique os dados verificados.", weight: 50, is_control: true },
      variant_b: { name: "Teste", system_prompt: "Pergunte qual etapa precisa de explicaÃ§Ã£o.", weight: 50, is_control: false } },
    risk_level: "low", approval_strategy: "manual" });
  await new PrismaHypothesisRepository(prisma).save(hypothesis, { runId: run.id, leaseToken: 1, discountStudy: study });
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: hypothesis.id } });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { status: "completed" } });
  const source = { merchantId, strategyId: hypothesis.id, version: 1, proposalHash: version.proposalHash, study, rules, policy, recommendation };
  const reviewCommand = { version: 1, proposal_hash: version.proposalHash, recommendation_hash: digest(recommendation ?? null), request_key: "specific-review" };
  const review = reviewed && mode === "planned" ? await reviews.decide(merchantId, "owner", hypothesis.id, "approve", reviewCommand) : null;
  const startsAt = new Date(Date.now() + 700).toISOString();
  const terms = mode === "planned" ? recommendedIncentiveBudgetTerms(source, startsAt) : incentiveBudgetTerms(source, { ...caps, startsAt });
  const input = { merchantId, terms, termsHash: digest(terms), actorId: "owner", requestKey: "budget-review" };
  return { merchantId, input, terms, version, run, hypothesis, source, reviewCommand, review };
}

async function ready(commercial?: CommercialMode) {
  const f = await fixture("store", defaultCaps, "planned", true, 0, commercial);
  const execution = await prisma.strategyIncentiveExecution.findFirstOrThrow({ where: { merchantId: f.merchantId } });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, execution.startedAt.getTime() - Date.now() + 10)));
  await prisma.product.create({ data: { id: "product", merchantId: f.merchantId, name: "Produto",
    variants: { create: { id: "variant", sku: "sku", price: { create: { basePriceInCents: 10000, costInCents: 4000 } } } } } });
  return { ...f, execution };
}

async function buyer(f: Awaited<ReturnType<typeof ready>>, arm: "control" | "treatment", patch: Record<string, unknown> = {}) {
  let buyerId = randomUUID();
  while (incentiveAssignmentArm(f.execution.id, buyerId) !== arm) buyerId = randomUUID();
  const now = new Date(), sessionId = randomUUID();
  await prisma.buyerIntentMemoryConsent.create({ data: { merchantId: f.merchantId, globalUserId: buyerId,
    optedIn: true, expiresAt: new Date(now.getTime() + 86400000), intents: { create: { primaryIntent: "price_sensitive",
      urgency: "high", budgetTier: "low", categoryFocus: [], painPoints: [], conversionLikelihoodPct: 10,
      behavioralSignalsJson: {}, generatedAt: now } } } });
  const row = await prisma.checkoutSession.create({ data: { merchantId: f.merchantId, sessionId, globalUserId: buyerId,
    conversationId: sessionId, cohort: "treatment", createdAt: now, updatedAt: now,
    cart: { currency: "BRL", total: 100, items: [{ sku: "sku", variantId: "variant", name: "Produto", price: 100, quantity: 1 }] },
    shipping: { customerPrice: 10, realCost: 10 }, ...patch } });
  return row;
}
async function admit(row: Awaited<ReturnType<typeof buyer>>) {
  const repository = new PrismaCheckoutRepository(prisma);
  const session = toCheckoutSession(row);
  await repository.saveSession(session);
  return session;
}
function payment(session: Awaited<ReturnType<typeof admit>>) {
  const discountCents = Math.round((session.cart.currentDiscount ?? 0) * 100), totalCents = 11000 - discountCents;
  return PaymentIntentEntity.create({ merchantId: session.merchantId, sessionId: session.sessionId, idempotencyKey: randomUUID(),
    currency: "BRL", method: "pix", amountCents: totalCents, amountBreakdown: { version: 1, currency: "BRL",
      cartFingerprint: paymentCartFingerprint(session), itemsSubtotalCents: 10000, shippingCents: 1000,
      discountCents, platformFeeCents: 0, totalCents } });
}

spec("checkout coupon entry preserves treatment assignment and rejects control, holdout and unassigned buyers", async () => {
  const f = await ready("fixed");
  const coupon = await prisma.coupon.findUniqueOrThrow({ where: { strategyIncentiveExecutionId: f.execution.id } });
  const treatment = await admit(await buyer(f, "treatment"));
  const control = await admit(await buyer(f, "control"));
  const holdout = await admit(await buyer(f, "treatment", { cohort: "holdout" }));
  const unassigned = toCheckoutSession(await buyer(f, "treatment"));
  const useCase = new ApplyCouponUseCase(undefined as never, undefined as never,
    { authorizeDiscount() { throw new Error("ordinary_coupon_authority_must_not_run"); } }, prisma);
  const enter = (session: typeof treatment) => useCase.executeForCheckout({ merchant_id: session.merchantId,
    session_id: session.sessionId, code: coupon.code.toLowerCase(), expectedVersion: session.persistenceVersion });
  const first = await enter(treatment);
  const repeated = await enter(first.session);
  assert.equal(first.result.redemption_id, treatment.cart.commercialNudge?.ruleId);
  assert.equal(repeated.result.redemption_id, first.result.redemption_id);
  assert.equal(first.result.discount_applied, 5);
  assert.equal(repeated.session.persistenceVersion, treatment.persistenceVersion);
  for (const excluded of [control, holdout, unassigned]) {
    await assert.rejects(enter(excluded), /COUPON_STRATEGY_NOT_ELIGIBLE/);
  }
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 2);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 1);
  assert.equal(await prisma.couponRedemption.count(), 0);
  assert.equal(await prisma.checkoutEvent.count({ where: { sessionId: treatment.sessionId, eventName: "coupon_applied" } }), 1);
  assert.equal((await prisma.strategyIncentiveBudget.findUniqueOrThrow({ where: { id: f.execution.budgetId } })).reservedCents, 500);
  process.env.REVENUE_COMMERCIAL_MODES_ENABLED = "false";
  await assert.rejects(enter(treatment), /COUPON_STRATEGY_NOT_ELIGIBLE/);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 1);
});

spec("approval atomically activates exact seven-day terms and admission applies only treatment", async () => {
  const f = await ready();
  assert.equal(f.execution.endsAt.getTime() - f.execution.startedAt.getTime(), 7 * 86400000);
  assert.equal((await reviews.read("store", f.hypothesis.id)).execution_status, "active");
  const treatment = await admit(await buyer(f, "treatment"));
  const control = await admit(await buyer(f, "control"));
  assert.equal(treatment.cart.currentDiscount, 5);
  assert.equal(control.cart.currentDiscount ?? 0, 0);
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 2);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 1);
  assert.equal((await prisma.strategyIncentiveBudget.findFirstOrThrow()).reservedCents, 500);
  const repository = new PrismaCheckoutRepository(prisma);
  await repository.saveSession(treatment);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 1);
  assert.equal(treatment.cart.currentDiscount, 5);
});

spec("concurrent repeated persistence grants a single reservation and stable assignment", async () => {
  const f = await ready(), row = await buyer(f, "treatment");
  const results = await Promise.allSettled([admit(row), admit(row)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 1);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 1);
});

spec("eligibility can appear at shipping persistence and never after an existing payment", async () => {
  const f = await ready();
  const original = await buyer(f, "treatment", { shipping: Prisma.DbNull });
  const session = await admit(original);
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 0);
  session.shipping = { customerPrice: 10, realCost: 10 };
  await new PrismaCheckoutRepository(prisma).saveSession(session);
  assert.equal(session.cart.currentDiscount, 5);
  const later = await buyer(f, "treatment");
  await prisma.paymentIntent.create({ data: { id: randomUUID(), merchantId: "store", sessionId: later.sessionId,
    idempotencyKey: "earlier-payment", amountCents: 11000, currency: "BRL", method: "pix", status: "failed" } });
  await admit(later);
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 1);
});

spec("unknown costs, changed catalog prices, no consent and holdout cannot receive incentives", async () => {
  const f = await ready();
  await admit(await buyer(f, "treatment", { cohort: "holdout" }));
  const consentless = await buyer(f, "treatment");
  await prisma.buyerIntentMemoryConsent.update({ where: { merchantId_globalUserId: { merchantId: "store", globalUserId: consentless.globalUserId } }, data: { optedIn: false } });
  await admit(consentless);
  await prisma.productPrice.update({ where: { variantId: "variant" }, data: { costInCents: null } });
  await admit(await buyer(f, "treatment"));
  await prisma.productPrice.update({ where: { variantId: "variant" }, data: { costInCents: 4000, basePriceInCents: 12000 } });
  await admit(await buyer(f, "treatment"));
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 0);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 0);
});

spec("real payment persistence validates then settles once; refunds retain historical spend", async () => {
  const f = await ready(), session = await admit(await buyer(f, "treatment"));
  const intent = payment(session), repository = new PrismaPaymentRepository(prisma);
  await repository.saveIntent({ intent });
  intent.markApproved({ providerPaymentId: "provider-incentive", approvedAmountCents: intent.snapshot().amountCents });
  await repository.saveIntent({ intent });
  let budget = await prisma.strategyIncentiveBudget.findFirstOrThrow();
  assert.equal(budget.reservedCents, 0); assert.equal(budget.spentCents, 500); assert.equal(budget.spentCount, 1);
  await prisma.completedOrder.create({ data: { id: randomUUID(), merchantId: "store", sessionId: session.sessionId,
    externalOrderId: "provider-incentive", orderTotal: 105, currency: "BRL", status: "approved", completedAt: new Date() } });
  const metrics = await new IncentiveMetricsService(prisma).read("store", f.hypothesis.id, 1);
  assert.equal(metrics.measurement?.treatment.assigned, 1);
  assert.equal(metrics.measurement?.treatment.redemptions, 1);
  assert.equal(metrics.measurement?.budget.spentCents, 500);
  assert.equal(metrics.measurement?.treatment.mature, 0);
  intent.markRefunded("buyer request");
  await repository.saveIntent({ intent });
  budget = await prisma.strategyIncentiveBudget.findFirstOrThrow();
  assert.equal(budget.spentCents, 500); assert.equal(budget.spentCount, 1);
  assert.equal(await prisma.strategyIncentivePaymentEvidence.count({ where: { status: "refunded" } }), 1);
});

spec("withdrawal preserves in-flight payment resolution and blocks new assignments", async () => {
  const f = await ready(), session = await admit(await buyer(f, "treatment"));
  const intent = payment(session), repository = new PrismaPaymentRepository(prisma);
  await repository.saveIntent({ intent });
  await reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "withdraw" });
  process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED = "false";
  intent.markApproved({ providerPaymentId: "late-provider", approvedAmountCents: intent.snapshot().amountCents });
  await repository.saveIntent({ intent });
  assert.equal((await prisma.strategyIncentiveBudget.findFirstOrThrow()).spentCents, 500);
  await admit(await buyer(f, "treatment"));
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 1);
});

spec("payment rejects changed cost/margin and invented discounts before creating intent", async () => {
  const f = await ready(), session = await admit(await buyer(f, "treatment"));
  const repository = new PrismaPaymentRepository(prisma), intent = payment(session);
  await prisma.productPrice.update({ where: { variantId: "variant" }, data: { costInCents: 9400 } });
  await assert.rejects(repository.saveIntent({ intent }), /MARGIN_CHANGED/);
  assert.equal(await prisma.paymentIntent.count(), 0);
  await prisma.productPrice.update({ where: { variantId: "variant" }, data: { costInCents: 4000 } });
  const altered = PaymentIntentEntity.rehydrate({ ...intent.snapshot(), amountBreakdown: { ...intent.snapshot().amountBreakdown!, discountCents: 1000, totalCents: 10000 }, amountCents: 10000 });
  await assert.rejects(repository.saveIntent({ intent: altered }), /AUTHORITY_CHANGED/);
});

spec("cart invalidation releases only unused budget and rejects an uncertain payment", async () => {
  const f = await ready(), session = await admit(await buyer(f, "treatment"));
  const intent = payment(session), repository = new PrismaPaymentRepository(prisma);
  await repository.saveIntent({ intent });
  await assert.rejects(tx(t => invalidateIncentiveCheckout(t, "store", session.sessionId)), /RESOLUTION_REQUIRED/);
  const second = await admit(await buyer(f, "treatment"));
  await tx(t => invalidateIncentiveCheckout(t, "store", second.sessionId));
  assert.equal(await prisma.strategyIncentiveReservation.count({ where: { status: "released" } }), 1);
});

spec("SQL preserves immutable membership and prevents simultaneous communication tests", async () => {
  const f = await ready(); await admit(await buyer(f, "treatment"));
  await assert.rejects(prisma.strategyIncentiveAssignment.updateMany({ data: { arm: "control", amountCents: 0, reservationId: null } }), /immutable/);
  await assert.rejects(prisma.promptExperiment.create({ data: { id: randomUUID(), merchantId: "store", name: "Conflict", status: "running" } }), /incentive experiment is active/);
  assert.equal(await prisma.promptExperiment.count(), 0);
});

spec("withdrawn benefit returns revised total without charging and requires explicit cart confirmation", async () => {
  const f = await ready(), session = await admit(await buyer(f, "treatment", {
    customer: { asaasCustomerId: "test-customer", email: "buyer@example.test" },
  }));
  await reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: "withdraw-before-payment" });
  const checkout = new PrismaCheckoutRepository(prisma), payments = new PrismaPaymentRepository(prisma);
  let providerCalls = 0;
  const provider = new FakePaymentProvider();
  const create = provider.createPayment.bind(provider);
  provider.createPayment = async input => { providerCalls++; return create(input); };
  const useCase = new CreatePaymentIntentUseCase(checkout, { getProfile: async () => ({ id: "store", name: "Store" }) } as never, payments, provider);
  const command = { merchant_id: "store", session_id: session.sessionId, idempotency_key: "payment-review", method: "pix" as const };
  let review: { confirmation_fingerprint: string; order_total_cents: number; total_to_pay_cents: number; service_fee_cents: number } | undefined;
  await assert.rejects(useCase.execute(command), error => {
    assert.ok(error instanceof ConflictException);
    const result = error.getResponse() as { code: string; review: typeof review };
    assert.equal(result.code, "checkout_review_required"); review = result.review; return true;
  });
  assert.ok(review); assert.equal(review.order_total_cents, 11000);
  assert.equal(review.total_to_pay_cents, review.order_total_cents + review.service_fee_cents);
  assert.equal((await checkout.getSession("store", session.sessionId))?.cart.currentDiscount, 0);
  assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(providerCalls, 0);
  assert.equal((await prisma.strategyIncentiveReservation.findFirstOrThrow()).status, "released");
  for (const patch of [{}, { confirmed_cart_fingerprint: "f".repeat(64) }]) {
    await assert.rejects(useCase.execute({ ...command, ...patch }), error => error instanceof ConflictException
      && (error.getResponse() as { code: string }).code === "checkout_review_required");
  }
  assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(providerCalls, 0);
  const earlierFingerprint = review.confirmation_fingerprint;
  process.env.PLATFORM_FEE_BRL = ((review.service_fee_cents + 100) / 100).toFixed(2);
  await assert.rejects(useCase.execute({ ...command, confirmed_cart_fingerprint: earlierFingerprint }), error => {
    assert.ok(error instanceof ConflictException);
    const result = error.getResponse() as { code: string; review: typeof review };
    assert.equal(result.code, "checkout_review_required"); review = result.review; return true;
  });
  assert.ok(review); assert.notEqual(review.confirmation_fingerprint, earlierFingerprint);
  assert.equal(providerCalls, 0); assert.equal(await prisma.paymentIntent.count(), 0);
  const accepted = await useCase.execute({ ...command, confirmed_cart_fingerprint: review.confirmation_fingerprint });
  assert.equal(accepted.amountCents, review.total_to_pay_cents); assert.equal(providerCalls, 1);
  assert.equal((await prisma.strategyIncentiveBudget.findFirstOrThrow()).spentCents, 0);
  const replay = await useCase.execute({ ...command, confirmed_cart_fingerprint: review.confirmation_fingerprint });
  assert.equal(replay.id, accepted.id); assert.equal(providerCalls, 1);
});

spec("a later external benefit cannot consume experimental funding or be removed because its amount matches", async () => {
  const f = await ready(), session = await admit(await buyer(f, "treatment"));
  const offerId = randomUUID(), now = new Date(), expiresAt = new Date(now.getTime() + 86400000);
  await prisma.authorizedOffer.create({ data: { id: offerId, merchantId: "store", sessionId: session.sessionId,
    type: "discount_percent", value: 5, approved: true, reason: "Separate authorized benefit", marginAfterOffer: .5, expiresAt } });
  await prisma.acceptedOffer.create({ data: { merchantId: "store", sessionId: session.sessionId, offerId,
    type: "discount_percent", value: 5, marginAfterOffer: .5, acceptedAt: now, expiresAt } });
  const external = { ...session.cart, commercialNudge: { kind: "coupon" as const, couponCode: "OTHER",
    title: "Outro benefício", message: "Benefício autorizado", ruleId: offerId } };
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: session.sessionId } }, data: { cart: external as unknown as Prisma.InputJsonValue } });
  const current = (await new PrismaCheckoutRepository(prisma).getSession("store", session.sessionId))!;
  await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent: payment(current) }), /AUTHORITY_CHANGED/);
  assert.equal(await new PrismaCheckoutRepository(prisma).reviseIncentiveForPaymentReview("store", session.sessionId), undefined);
  const retained = (await new PrismaCheckoutRepository(prisma).getSession("store", session.sessionId))!;
  assert.equal(retained.cart.currentDiscount, 5); assert.equal(retained.cart.commercialNudge?.couponCode, "OTHER");
  assert.equal((await prisma.strategyIncentiveReservation.findFirstOrThrow()).status, "reserved");
  assert.equal(await prisma.paymentIntent.count(), 0);
});

for (const mode of ["fixed", "percentage", "shipping"] as const) spec(`v3 ${mode}: specific approval, A/B admission, payment settlement, metrics and withdrawal share one authority`, async () => {
  const f = await ready(mode);
  const expected = `capped_${mode}_discount`;
  assert.equal((f.execution.recommendation as any).test.kind, expected);
  const treatment = await admit(await buyer(f, "treatment"));
  const control = await admit(await buyer(f, "control"));
  await admit(await buyer(f, "treatment", { cohort: "holdout" }));
  assert.equal(treatment.cart.currentDiscount, 5);
  assert.equal(control.cart.currentDiscount ?? 0, 0);
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 2);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 1);
  assert.equal(await prisma.coupon.count(), mode === "fixed" ? 1 : 0);
  if (mode === "fixed") assert.match(treatment.cart.commercialNudge?.couponCode ?? "", /^ZYON[A-F0-9]{20}$/);
  if (mode === "shipping") {
    assert.equal(treatment.shipping?.customerPrice, 10);
    assert.match(treatment.cart.commercialNudge?.title ?? "", /frete/);
  }
  const intent = payment(treatment), repository = new PrismaPaymentRepository(prisma);
  await repository.saveIntent({ intent });
  intent.markApproved({ providerPaymentId: `provider-${mode}`, approvedAmountCents: 10500 });
  await repository.saveIntent({ intent });
  const metrics = await new IncentiveMetricsService(prisma).read("store", f.hypothesis.id, 1);
  assert.equal(metrics.measurement?.budget.spentCents, 500);
  assert.equal(metrics.measurement?.treatment.assigned, 1);
  assert.equal(metrics.measurement?.control.assigned, 1);
  assert.equal(metrics.measurement?.treatment.redemptions, 1);
  if (mode === "fixed") assert.equal((await prisma.coupon.findFirstOrThrow()).usagesCount, 1);
  await reviews.decide("store", "owner", f.hypothesis.id, "withdraw", { ...f.reviewCommand, request_key: `withdraw-${mode}` });
  await admit(await buyer(f, "treatment"));
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 2);
  if (mode === "fixed") assert.equal((await prisma.coupon.findFirstOrThrow()).status, "expired");
  intent.markRefunded("buyer request"); await repository.saveIntent({ intent });
  assert.equal((await prisma.strategyIncentiveBudget.findFirstOrThrow()).spentCents, 500);
});

spec("v3 freight revalidates selected quote, cost and shipping permission before payment", async () => {
  const f = await ready("shipping");
  const treatment = await admit(await buyer(f, "treatment"));
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: "store", sessionId: treatment.sessionId } },
    data: { shipping: { customerPrice: 10, realCost: 40 } } });
  const changed = (await new PrismaCheckoutRepository(prisma).getSession("store", treatment.sessionId))!;
  await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent: payment(changed) }), /AUTHORITY_CHANGED/);
  assert.equal(await prisma.paymentIntent.count(), 0);
  await admit(await buyer(f, "treatment", { shipping: { customerPrice: 3, realCost: 3 } }));
  await admit(await buyer(f, "treatment", { shipping: { customerPrice: 10 } }));
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 1);
  process.env.REVENUE_COMMERCIAL_MODES_ENABLED = "false";
  await admit(await buyer(f, "treatment"));
  assert.equal(await prisma.strategyIncentiveAssignment.count(), 1);
});

spec("SQL denies public redemption, changed code, foreign owner, removed binding and forged coupon capacity", async () => {
  const f = await ready("fixed"), coupon = await prisma.coupon.findFirstOrThrow();
  const row = await buyer(f, "treatment");
  await assert.rejects(prisma.couponRedemption.create({ data: { id: randomUUID(), merchantId: "store", couponId: coupon.id,
    sessionId: row.sessionId, buyerGlobalUserId: row.globalUserId, discountApplied: 5, source: "manual" } }), /incentive assignment and budget/);
  for (const data of [{ code: "PUBLIC" }, { strategyIncentiveExecutionId: null }, { maxUsages: 1000000 },
    { merchantId: "other" }, { discountValue: 50 }, { usagesCount: 2 }]) {
    await assert.rejects(prisma.coupon.update({ where: { id: coupon.id }, data }), /strategy coupon/);
  }
  await assert.rejects(prisma.coupon.delete({ where: { id: coupon.id } }), /immutable/);
  assert.equal(await tx(t => applyIncentiveCoupon(t, row, { executionId: f.execution.id, code: coupon.code })), null);
  assert.equal(await prisma.strategyIncentiveReservation.count(), 0);
  assert.equal(await prisma.couponRedemption.count(), 0);
});

for (const mode of ["fixed", "shipping", "percentage"] as const) spec(`SQL verifies v3 ${mode} conservative alternatives and rejects forged terms`, async () => {
  const f = await fixture("store", defaultCaps, "planned", false, 0, mode), primary = f.source.recommendation!;
  for (let sequence = 1; sequence <= 3; sequence++) {
    const alternative = conservativeIncentiveAlternative(primary, sequence)!;
    const [result] = await prisma.$queryRaw<Array<{ matches: boolean; valid: boolean }>>`
      SELECT incentive_recommendation_matches_frozen(${JSON.stringify(alternative)}::jsonb, ${JSON.stringify(primary)}::jsonb) AS matches,
        valid_strategy_commercial_terms(${JSON.stringify(alternative)}::jsonb, ${JSON.stringify(f.source.study)}::jsonb) AS valid`;
    assert.equal(result.matches, true); assert.equal(result.valid, true);
    const forged = structuredClone(alternative) as any;
    forged.test.kind = "capped_unknown_discount";
    const [invalid] = await prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT
      valid_strategy_commercial_terms(${JSON.stringify(forged)}::jsonb, ${JSON.stringify(f.source.study)}::jsonb) AS valid`;
    assert.equal(invalid.valid, false);
  }
});

spec("SQL commercial validation rejects missing documents, missing economics and null evidence", async () => {
  const f = await fixture("store", defaultCaps, "planned", false, 0, "fixed");
  for (const [recommendation, study] of [[null, f.source.study], [{}, f.source.study], [f.source.recommendation, null],
    [f.source.recommendation, {}]]) {
    const [row] = await prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT
      valid_strategy_commercial_terms(${JSON.stringify(recommendation)}::jsonb, ${JSON.stringify(study)}::jsonb) AS valid`;
    assert.equal(row.valid, false);
  }
  for (const mutate of [
    (r: any, _s: any) => delete r.test.discountPercent,
    (r: any, _s: any) => r.test.discountPercent = null,
    (r: any, _s: any) => r.test.discountPercent = -1,
    (r: any, _s: any) => r.test.maxDiscountCents = 0,
    (_r: any, s: any) => delete s.commercialCandidate.maxDiscountCents,
    (_r: any, s: any) => s.commercialCandidate.evidence = null,
    (_r: any, s: any) => delete s.commercialCandidate.evidence.basis,
  ]) {
    const r = structuredClone(f.source.recommendation), s = structuredClone(f.source.study); mutate(r, s);
    const [row] = await prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT
      valid_strategy_commercial_terms(${JSON.stringify(r)}::jsonb, ${JSON.stringify(s)}::jsonb) AS valid`;
    assert.equal(row.valid, false);
  }
});

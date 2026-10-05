import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { IncentivePolicyService } from "../application/incentive-policy.service.js";
import { IncentiveReviewService } from "../application/incentive-review.service.js";
import { StrategyReviewService } from "../application/strategy-review.service.js";
import { incentivePolicySnapshot } from "../domain/incentive-policy.js";
import { plannerDiscountStudy } from "../domain/strategy-discount-study.js";
import { revenueIncentiveOptions, type RevenueIncentiveOptions } from "../domain/revenue-incentive-options.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { PrismaObservationRepository } from "./prisma-observation.repository.js";
import { PrismaHypothesisRepository } from "./prisma-hypothesis.repository.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { prepareDiscountStudy, readFrozenIncentiveOptions } from "./strategy-discount-study.js";
import { executeStrategyPlannerTool } from "./strategy-planner-tool.js";
import { loadDiscountHistory } from "./discount-cohort.reader.js";
import { incentiveAssignmentArm } from "./incentive-execution-ledger.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentRepository } from "../../payment/infrastructure/prisma-payment.repository.js";
import { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { toCheckoutSession } from "../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { insertStrategyVersion } from "./strategy-version.writer.js";

const url = new URL(process.env.REVENUE_STRATEGY_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_strategy_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, transactionOptions: { maxWait: 10000, timeout: 30000 } });
const env = { ...process.env }, policies = new IncentivePolicyService(prisma);
const reviews = new IncentiveReviewService(prisma, { getEffectivePlan: async () => "scale" } as never);
const spec = (name: string, fn: () => Promise<void>) => test(`automatic policy ${name}`, { skip: !enabled }, fn);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { process.env = env; await prisma.$disconnect(); });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, REVENUE_WEEKLY_ENABLED: "true", REVENUE_WEEKLY_MERCHANT_IDS: "store",
    REVENUE_STRATEGY_PLANNER_ENABLED: "true", REVENUE_COMMERCIAL_MODES_ENABLED: "true", REVENUE_COMMERCIAL_MODES_MERCHANT_IDS: "store",
    REVENUE_DISCOUNT_STUDY_ENABLED: "true", REVENUE_DISCOUNT_STUDY_MERCHANT_IDS: "store",
    REVENUE_INCENTIVE_BUDGET_ENABLED: "true", REVENUE_INCENTIVE_BUDGET_MERCHANT_IDS: "store",
    REVENUE_INCENTIVE_REVIEW_ENABLED: "true", REVENUE_INCENTIVE_REVIEW_MERCHANT_IDS: "store",
    REVENUE_STRATEGY_REVISIONS_ENABLED: "true", REVENUE_AI_MAX_REVISIONS_PER_CYCLE: "3",
    REVENUE_INCENTIVE_EXECUTION_ENABLED: "true", REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: "store", REVENUE_STRATEGY_MEASUREMENT_ENABLED: "false" };
  await prisma.$executeRawUnsafe(`TRUNCATE revenue_strategies, revenue_analysis_runs, revenue_analysis_schedules,
    revenue_manager_hypotheses, revenue_manager_observations, merchant_notifications, merchant_rules, checkout_settings,
    merchants, checkout_sessions, completed_orders, prompt_experiments, coupons, products,
    buyer_intent_memory_consents, customer_intent_records, payment_intents CASCADE`);
});

async function fixture(realHistory = false, selected: "fixed" | "communication_only" = "fixed", conversionRate = .1) {
  const merchantId = "store", now = new Date(), historical = new Date(now.getTime() - 14 * 86400000);
  await prisma.merchant.create({ data: { id: merchantId, name: "Automatic policy test" } });
  const rules = merchantRulesSnapshot(await prisma.merchantRule.create({ data: { merchantId,
    maxDiscountPercent: 5, minimumMarginPercent: 30, allowFreeShipping: false, allowShippingDiscount: true,
    allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: true, autonomousEngineEnabled: true,
    freeShippingMinCartValue: 200, maxShippingSubsidy: 5, maxPartialShippingDiscount: 5, offerExpirationMinutes: 15,
    blockedRegions: [], brandVoice: "consultative" } }));
  await prisma.product.create({ data: { id: "product", merchantId, name: "Produto", variants: { create: { id: "variant", sku: "sku",
    price: { create: { basePriceInCents: 10000, costInCents: 4000 } } } } } });
  const observation = ObservationEntity.create({ merchant_id: merchantId,
    observation_window_start: new Date(now.getTime() - 28 * 86400000), observation_window_end: now,
    funnel: { total_sessions: 10000, started_checkout: 10000, reached_shipping: 10000, reached_payment: 10, completed_order: 10, conversion_rate: .001 },
    abandonment: { abandoned_at_shipping: 9990, abandoned_at_payment: 0, abandonment_rate: .999, top_abandonment_objection: "shipping_cost" },
    objections: { shipping_cost_count: 9990, price_count: 0, trust_count: 0, payment_count: 0, unknown_count: 0 },
    cross_sell: { suggestions_shown: 0, suggestions_accepted: 0, acceptance_rate: 0, top_suggested_skus: [] },
    cohorts: { new_customers_rate: 1, returning_customers_rate: 0, high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
    revenue: { total_orders: 10, total_revenue_cents: 110000, avg_order_value_cents: 11000 }, ai_costs_cents: 0 });
  await new PrismaObservationRepository(prisma).save(observation);
  const run = await prisma.revenueAnalysisRun.create({ data: { merchantId, cycle: 1, status: "running", asOf: now,
    observationId: observation.id, leaseToken: 1, leaseUntil: new Date(now.getTime() + 600000) } });
  await prisma.revenueAnalysisSchedule.create({ data: { merchantId, group: 0, nextDueAt: now, currentRunId: run.id } });
  const cart = { currency: "BRL", total: 100, items: [{ sku: "sku", variantId: "variant", name: "Produto", price: 100, cost: 40, quantity: 1 }] };
  const shipping = { customerPrice: 10, realCost: 10 };
  let study;
  if (realHistory) {
    const buyers = Array.from({ length: 10000 }, (_, i) => `history-${i}`);
    for (let offset = 0; offset < buyers.length; offset += 500) {
      const batch = buyers.slice(offset, offset + 500);
      await prisma.buyerIntentMemoryConsent.createMany({ data: batch.map(id => ({ merchantId, globalUserId: id, optedIn: true,
        expiresAt: new Date(now.getTime() + 86400000) })) });
      await prisma.customerIntentRecord.createMany({ data: batch.map(id => ({ merchantId, globalUserId: id, primaryIntent: "price_sensitive",
        urgency: "high", budgetTier: "low", categoryFocus: [], painPoints: ["shipping_cost"], conversionLikelihoodPct: 1,
        behavioralSignalsJson: {}, generatedAt: new Date(historical.getTime() - 1000) })) });
      await prisma.checkoutSession.createMany({ data: batch.map(id => ({ merchantId, sessionId: id, conversationId: id,
        globalUserId: id, cohort: "treatment", cart, shipping, createdAt: historical, updatedAt: historical })) });
    }
    await prisma.completedOrder.createMany({ data: buyers.slice(0, 10).map(id => ({ merchantId, sessionId: id,
      externalOrderId: `order-${id}`, currency: "BRL", orderTotal: 110, status: "approved", completedAt: new Date(historical.getTime() + 86400000) })) });
    const history = await prisma.$transaction(tx => loadDiscountHistory(tx, merchantId, now, 28),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    assert.equal(history.complete, true);
    assert.equal(history.buyers.length, 10000, "all eligible buyers remain in the denominator");
    assert.equal(history.buyers.filter(buyer => buyer.converted).length, 10, "mature approved orders define conversions");
    assert.equal(history.buyers.filter(buyer => buyer.cohort === "treatment").length, 10000);
    study = await prepareDiscountStudy(prisma, merchantId, { runId: run.id, leaseToken: 1 });
  } else {
    study = plannerDiscountStudy({ merchantId, runId: run.id, observationId: observation.id, rules,
      asOf: now.toISOString(), capturedAt: now.toISOString(), cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate,
        carts: Array.from({ length: 30 }, () => cart), shipping: Array.from({ length: 30 }, () => shipping) }] });
    const initial = incentivePolicySnapshot(merchantId, 0, { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 });
    const options = revenueIncentiveOptions(study, rules, { snapshot: initial, mode: "automatic" }, () => ({ buyers: 10000,
      conversions: 10, complete: true, windowStart: new Date(now.getTime() - 35 * 86400000).toISOString(),
      windowEnd: new Date(now.getTime() - 7 * 86400000).toISOString() }));
    // Match the production capture path: exact JSON text, not Prisma's JSON
    // number transport, so later publications must preserve this evidence.
    await prisma.$executeRaw`UPDATE revenue_analysis_runs
      SET discount_study_json=${JSON.stringify(study)}::jsonb, incentive_options_json=${JSON.stringify(options)}::jsonb
      WHERE id=${run.id} AND merchant_id=${merchantId}`;
  }
  assert.ok(study);
  const catalog = (await readFrozenIncentiveOptions(prisma, merchantId, { runId: run.id, leaseToken: 1 }))!;
  assert.equal(catalog.options.length, 4, JSON.stringify(study));
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0);
  const option = catalog.options.find(o => o.recommendation.selectedCandidateKey === "fixed")!;
  const response = executeStrategyPlannerTool({ tool_calls: [{ id: "call-fixture", type: "function", function: {
    name: "submit_revenue_strategy", arguments: JSON.stringify({ selected_action: selected === "communication_only" ? selected : option.id,
      rationale: "Comparar a condição aprovada entre compradores elegíveis.", hypothesis_text: "Testar uma condição para os pedidos elegíveis",
      reasoning: "Usar os dados medidos da loja.", name: "Condição sugerida", description: "Teste com limites visíveis.",
      communication_addendum: "Explique as etapas disponíveis no pedido." }) } }] }, { merchant_id: merchantId, observation: observation.snapshot(),
    past_lessons: [], current_prompt: "Explique os dados verificados.", incentive_options: catalog,
    constraints: { max_discount_percent: 5, allow_free_shipping: false, max_running_experiments: 1, merchant_rules: rules } });
  const hypothesis = HypothesisEntity.create({ merchant_id: merchantId, observation_id: observation.id, ...response,
    risk_level: "low", approval_strategy: "manual" });
  await new PrismaHypothesisRepository(prisma).save(hypothesis, { runId: run.id, leaseToken: 1, discountStudy: study,
    orchestration: response.strategy_plan });
  await prisma.revenueAnalysisRun.update({ where: { id: run.id }, data: { status: "completed" } });
  const version = await prisma.revenueStrategyVersion.findFirstOrThrow({ where: { strategyId: hypothesis.id } });
  const input = { version: 1, proposal_hash: version.proposalHash, recommendation_hash: option.id, request_key: "approve-auto" };
  return { merchantId, run, study, catalog, option, hypothesis, version, input, cart, shipping, rules };
}

spec("full observed-history capture, model choice and publication stay unfunded until exact approval, then settle a targeted coupon", async () => {
  const f = await fixture(true);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
  assert.equal((await policies.read("store")).mode, "automatic");
  assert.equal((await reviews.read("store", f.hypothesis.id)).approval_available, true);
  const decision = await reviews.decide("store", "owner", f.hypothesis.id, "approve", f.input);
  const policy = await prisma.merchantIncentivePolicy.findFirstOrThrow();
  assert.equal(policy.origin, "automatic"); assert.equal(policy.enabled, true); assert.ok(policy.approvedReviewId);
  assert.equal(policy.limitCents, f.option.recommendation.financialPolicy.limitCents);
  assert.equal((await policies.read("store")).mode, "automatic");
  assert.deepEqual(await reviews.decide("store", "owner", f.hypothesis.id, "approve", f.input), decision);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 1);
  const execution = await prisma.strategyIncentiveExecution.findFirstOrThrow();
  await new Promise(resolve => setTimeout(resolve, Math.max(0, execution.startedAt.getTime() - Date.now() + 10)));
  let buyerId = randomUUID(); while (incentiveAssignmentArm(execution.id, buyerId) !== "treatment") buyerId = randomUUID();
  const now = new Date(), sessionId = randomUUID();
  await prisma.buyerIntentMemoryConsent.create({ data: { merchantId: "store", globalUserId: buyerId, optedIn: true,
    expiresAt: new Date(now.getTime() + 86400000), intents: { create: { primaryIntent: "price_sensitive", urgency: "high", budgetTier: "low",
      categoryFocus: [], painPoints: [], conversionLikelihoodPct: 10, behavioralSignalsJson: {}, generatedAt: now } } } });
  const row = await prisma.checkoutSession.create({ data: { merchantId: "store", sessionId, globalUserId: buyerId, conversationId: sessionId,
    cohort: "treatment", cart: f.cart, shipping: f.shipping, createdAt: now, updatedAt: now } });
  const session = toCheckoutSession(row); await new PrismaCheckoutRepository(prisma).saveSession(session);
  assert.equal(session.cart.currentDiscount, 5); assert.match(session.cart.commercialNudge?.couponCode ?? "", /^ZYON/);
  const intent = PaymentIntentEntity.create({ merchantId: "store", sessionId, idempotencyKey: randomUUID(), currency: "BRL", method: "pix", amountCents: 10500,
    amountBreakdown: { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(session), itemsSubtotalCents: 10000,
      shippingCents: 1000, discountCents: 500, platformFeeCents: 0, totalCents: 10500 } });
  const payments = new PrismaPaymentRepository(prisma); await payments.saveIntent({ intent });
  intent.markApproved({ providerPaymentId: "auto-policy-provider", approvedAmountCents: 10500 }); await payments.saveIntent({ intent });
  assert.equal((await prisma.strategyIncentiveBudget.findFirstOrThrow()).spentCents, 500);
  assert.equal((await prisma.coupon.findFirstOrThrow()).usagesCount, 1);
});

spec("rejection creates no policy, coupon or financial authorization", async () => {
  const f = await fixture();
  await reviews.decide("store", "owner", f.hypothesis.id, "reject", { ...f.input, request_key: "reject-auto" });
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0); assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
  assert.equal(await prisma.coupon.count(), 0);
});

spec("a reviewed revision may select another exact catalog option while the run preserves its initial choice", async () => {
  // This exact double was changed by Prisma JSON serialization in the real
  // sandbox: 0.00015384615384615385 became 0.0001538461538461539.
  const f = await fixture(false, "fixed", 1 / 6500);
  assert.equal((f.version.proposal as any).discountStudy.candidate.simulation.observedConversionRate, 1 / 6500);
  assert.equal(f.version.proposalHash, digest(f.version.proposal));
  const revised = f.catalog.options.find(option => option.recommendation.selectedCandidateKey === "shipping")!;
  assert.notEqual(revised.id, f.option.id);
  const service = new StrategyReviewService(prisma, {
    getRules: async () => f.rules, getCurrentPrompt: async () => "Explique os dados verificados.",
  } as never, { generate: async (request: Parameters<typeof executeStrategyPlannerTool>[1]) => executeStrategyPlannerTool({
    tool_calls: [{ id: "revision-shipping", type: "function", function: { name: "submit_revenue_strategy", arguments: JSON.stringify({
      selected_action: revised.id, rationale: "Comparar a condição de frete medida no estudo da loja.",
      hypothesis_text: "Testar a condição de frete para compradores elegíveis", reasoning: "Os dados de frete justificam a alternativa.",
      name: "Condição de frete", description: "Comparação com limites explícitos.", communication_addendum: "Explique as etapas disponíveis no pedido.",
    }) } }],
  }, request) } as never, { getEffectivePlan: async () => "scale" } as never);
  const action = await service.decide("store", "owner", f.hypothesis.id, "revision", {
    version: 1, proposal_hash: f.version.proposalHash, request_key: "request-shipping", feedback: "Sugira uma alternativa para o frete.",
  });
  await service.process(action.action_id);
  assert.equal((await prisma.revenueStrategyRevision.findUniqueOrThrow({ where: { id: action.action_id } })).status, "completed");
  const version = await prisma.revenueStrategyVersion.findUniqueOrThrow({ where: { strategyId_merchantId_version: {
    strategyId: f.hypothesis.id, merchantId: "store", version: 2,
  } } });
  assert.deepEqual((version.proposal as any).incentiveRecommendation, revised.recommendation);
  assert.equal((version.proposal as any).discountStudy.candidate.simulation.observedConversionRate, 1 / 6500);
  assert.equal(version.proposalHash, digest(version.proposal));
  assert.equal((version.proposal as any).orchestration.selectedAction, revised.id);
  assert.deepEqual((await prisma.revenueAnalysisRun.findUniqueOrThrow({ where: { id: f.run.id } })).incentiveRecommendationJson, f.option.recommendation);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", f.input), /INCENTIVE_REVIEW_PROPOSAL_CHANGED/);
  await reviews.decide("store", "owner", f.hypothesis.id, "approve", { version: 2, proposal_hash: version.proposalHash,
    recommendation_hash: revised.id, request_key: "approve-shipping" });
  const policy = await prisma.merchantIncentivePolicy.findFirstOrThrow();
  assert.equal(policy.origin, "automatic");
  assert.equal(policy.policyHash, revised.recommendation.financialPolicy.policyHash);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 1);
  assert.equal((await prisma.strategyIncentiveReview.findFirstOrThrow()).version, 2);
});

spec("exact JSON version writer retains catalog and merchant constraints for the sandbox regression double", async () => {
  const f = await fixture(false, "fixed", 1 / 6500);
  const proposal = structuredClone(f.version.proposal) as any;
  const forged = structuredClone(proposal);
  forged.incentiveRecommendation.test.limitCents++;
  await assert.rejects(prisma.$transaction(tx => insertStrategyVersion(tx, { strategyId: f.hypothesis.id,
    merchantId: "store", version: 2, proposal: forged, proposalHash: digest(forged), expiresAt: f.version.expiresAt })), /CATALOG_SELECTION/);
  await assert.rejects(prisma.$transaction(tx => insertStrategyVersion(tx, { strategyId: f.hypothesis.id,
    merchantId: "foreign", version: 2, proposal, proposalHash: digest(proposal), expiresAt: f.version.expiresAt })), /foreign key/i);
  assert.equal(await prisma.revenueStrategyVersion.count({ where: { strategyId: f.hypothesis.id } }), 1);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0);
  assert.equal(await prisma.strategyIncentiveBudget.count(), 0);
});

spec("manual cap added after proposal invalidates pending automatic exposure instead of being raised", async () => {
  const f = await fixture();
  await policies.save("store", "owner", { expectedVersion: 0, requestKey: "manual-cap", mode: "manual", enabled: true,
    limitCents: 30000, maxDiscountCents: 1000, maxRedemptions: 30 });
  const review = await reviews.read("store", f.hypothesis.id);
  assert.equal(review.approval_available, false); assert.ok(review.approval_blockers.includes("financial_policy_changed"));
  await assert.rejects(reviews.decide("store", "owner", f.hypothesis.id, "approve", f.input), (error: any) => {
    assert.equal(error.getResponse().code, "INCENTIVE_REVIEW_PREREQUISITES_REQUIRED");
    assert.ok(error.getResponse().blockers.includes("financial_policy_changed"));
    return true;
  });
  assert.equal(await prisma.merchantIncentivePolicy.count(), 1);
  assert.equal((await prisma.merchantIncentivePolicy.findFirstOrThrow()).maxRedemptions, 30);
  assert.equal(await prisma.strategyIncentiveReview.count(), 0);
});

spec("a frozen catalog, publication selection and proposed policy cannot be forged or authorized without review", async () => {
  const f = await fixture();
  await assert.rejects(prisma.revenueAnalysisRun.update({ where: { id: f.run.id }, data: { incentiveOptionsJson: { ...f.catalog, options: [] } } }), /IMMUTABLE/);
  const proposal = structuredClone(f.version.proposal) as any;
  const forged = structuredClone(proposal);
  forged.incentiveRecommendation.test.limitCents++;
  forged.orchestration.selectedAction = digest(forged.incentiveRecommendation);
  const [guard] = await prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT revenue_proposal_matches_catalog(${JSON.stringify(forged)}::jsonb, ${JSON.stringify(f.catalog)}::jsonb) AS valid`;
  assert.equal(guard.valid, false);
  await assert.rejects(prisma.revenueStrategyVersion.create({ data: { merchantId: "store", strategyId: f.hypothesis.id, version: 2,
    proposalHash: digest(forged), proposal: forged, expiresAt: f.version.expiresAt } }), /CATALOG_SELECTION|revision/i);
  proposal.orchestration.selectedAction = "communication_only";
  await assert.rejects(prisma.revenueStrategyVersion.create({ data: { merchantId: "store", strategyId: f.hypothesis.id, version: 2,
    proposalHash: digest(proposal), proposal, expiresAt: f.version.expiresAt } }), /CATALOG_SELECTION|revision/i);
  const p = f.option.recommendation.financialPolicy;
  await assert.rejects(prisma.merchantIncentivePolicy.create({ data: { merchantId: "store", version: 1, origin: "automatic",
    approvedReviewId: randomUUID(), actorId: "owner", requestKey: "forged-auto", requestHash: "f".repeat(64), policyHash: p.policyHash,
    enabled: true, limitCents: p.limitCents, maxDiscountCents: p.maxDiscountCents, maxRedemptions: p.maxRedemptions } }), /approval|Foreign key/i);
  assert.equal(await prisma.merchantIncentivePolicy.count(), 0);
  await assert.rejects(reviews.decide("other", "owner", f.hypothesis.id, "approve", f.input), /NOT_FOUND/);
});

spec("policy preferences support explicit optional manual limits and automatic reset without granting money", async () => {
  await prisma.merchant.create({ data: { id: "store", name: "Store" } });
  assert.equal((await policies.read("store")).mode, "automatic");
  const manual = await policies.save("store", "owner", { expectedVersion: 0, requestKey: "manual", mode: "manual",
    limitCents: 30000, maxDiscountCents: 1000, maxRedemptions: 30 });
  const reset = await policies.save("store", "owner", { expectedVersion: manual.version, requestKey: "automatic", mode: "automatic" });
  assert.equal(reset.enabled, false); assert.equal(reset.limitCents, 0); assert.equal((await policies.read("store")).mode, "automatic");
  const disabled = await policies.save("store", "owner", { expectedVersion: reset.version, requestKey: "disabled", mode: "disabled" });
  assert.equal(disabled.enabled, false); assert.equal((await policies.read("store")).mode, "disabled");
  for (const invalid of [null, [], {}, { expectedVersion: disabled.version, requestKey: "bad", mode: "automatic", limitCents: 1 }]) {
    await assert.rejects(policies.save("store", "owner", invalid as never), /INVALID_/);
  }
});

spec("database canonical hashes match application integers, rates, scientific notation and signed zero", async () => {
  const values = [0, -0, 500, 2147483647, .1, .000001, .0000001, 4.999999999e-7, 1e20, 1e21, 1e-20, -1e-7, 96.00000000000001];
  for (const value of values) {
    const document = { value, nested: [value, { maxDiscountCents: 500, minimumProjectedMarginPercent: value }] };
    const [row] = await prisma.$queryRaw<Array<{ hash: string }>>`SELECT revenue_json_hash(${JSON.stringify(document)}::jsonb) AS hash`;
    assert.equal(row.hash, digest(document), `numeric ${value}`);
  }
});
